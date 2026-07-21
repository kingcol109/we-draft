import React, { useEffect, useMemo, useState } from "react";
import { DndContext, closestCenter, DragOverlay, useDroppable, useSensor, useSensors, PointerSensor } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { useAuth } from "../context/AuthContext";
import { CSS } from "@dnd-kit/utilities";
import { collection, getDocs, getDoc, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { useRef } from "react";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";
const SITE_INK = "#0b1220";
const SITE_BORDER = "#e6e9ef";
const SITE_BG = "#f5f7fb";

const POSITIONS = ["QB","RB","WR","TE","OL","DL","EDGE","LB","DB"];
const ROUNDS = ["ROUND 1","ROUND 2","ROUND 3","ROUND 4","ROUND 5","ROUND 6","ROUND 7","UDFA"];
const DRAFT_CLASSES = ["2027","2028","2026"];

const POS_COLORS = {
  QB: "#4169E1", RB: "#D32F2F", WR: "#2E7D32", TE: "#F57C00",
  OL: "#B08D00", EDGE: "#8E24AA", DL: "#0097A7", LB: "#0D47A1", DB: "#EC407A"
};

// Retries a Firestore call a few times if it fails with permission-denied.
// This covers a known race where onAuthStateChanged resolves slightly ahead
// of Firestore's internal credential provider on a fresh page load / new
// tab — the very first protected read can fail even though the user is
// genuinely signed in and legitimately authorized.
async function withAuthRetry(fn, retries = 3, delayMs = 400) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isPermissionRace = err?.code === "permission-denied";
      if (!isPermissionRace || i === retries - 1) throw err;
      await new Promise(res => setTimeout(res, delayMs * (i + 1)));
    }
  }
}

export default function Whiteboard() {
  const { user, authReady } = useAuth();
  const [selectedClass, setSelectedClass] = useState("2027");
  const [allPlayers, setAllPlayers] = useState([]);
  const [board, setBoard] = useState(null);
  const [markers, setMarkers] = useState({});
  const [isDirty, setIsDirty] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const playerBankRef = useRef(null);
  const headerScrollRef = useRef(null);
  const boardScrollRef = useRef(null);
  const lastScrollYRef = useRef(0);
  const [posHeaderHidden, setPosHeaderHidden] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor));

  const scrollToPlayers = () => {
    playerBankRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const syncHeaderScroll = (e) => {
    if (boardScrollRef.current) boardScrollRef.current.scrollLeft = e.target.scrollLeft;
  };
  const syncBodyScroll = (e) => {
    if (headerScrollRef.current) headerScrollRef.current.scrollLeft = e.target.scrollLeft;
  };

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;
      const lastY = lastScrollYRef.current;
      if (currentY < 120) {
        setPosHeaderHidden(false);
      } else if (currentY > lastY + 4) {
        setPosHeaderHidden(true);
      } else if (currentY < lastY - 4) {
        setPosHeaderHidden(false);
      }
      lastScrollYRef.current = currentY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    const loadPlayers = async () => {
      try {
        const snap = await withAuthRetry(() => getDocs(collection(db, "players")));
        const players = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(p => p.Eligible === selectedClass)
          .filter(p => {
            const live = p.Live;
            return live !== false && live !== 0 && live !== "false" && live !== "no" && live !== null;
          });
        setAllPlayers(players);
      } catch (err) {
        console.error("Failed to load players:", err);
        setLoadError("We couldn't load player data. Please refresh the page.");
      }
    };
    loadPlayers();
  }, [selectedClass, user, authReady]);

  useEffect(() => {
    if (!authReady || !allPlayers.length || !user) return;
    const loadBoard = async () => {
      try {
        const boardRef = doc(db, "whiteboards", `${user.uid}_${selectedClass}`);
        const snap = await withAuthRetry(() => getDoc(boardRef), 5, 600);
        if (snap.exists()) {
          setBoard(snap.data().board);
          setMarkers(snap.data().markers || {});
        } else {
          const empty = {};
          ROUNDS.forEach(r => {
            empty[r] = {};
            POSITIONS.forEach(p => { empty[r][p] = []; });
          });
          setBoard(empty);
          setMarkers({});
        }
      } catch (err) {
        console.error("Failed to load whiteboard:", err.code, err.message, err);
        setLoadError("We couldn't load your whiteboard. Please refresh the page.");
      }
    };
    loadBoard();
  }, [allPlayers, selectedClass, user, authReady]);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const getPlayerPos = (p) => (p.Position || "").toUpperCase();

  const getBankContainerForPlayer = (playerId) => {
    const p = allPlayers.find(x => x.id === playerId);
    if (!p) return null;
    const raw = getPlayerPos(p);
    if (raw === "CB" || raw === "S" || raw === "DB") return `bank::DB`;
    if (POSITIONS.includes(raw)) return `bank::${raw}`;
    return null;
  };

  const findContainer = (id) => {
    if (!board) return null;
    if (typeof id === "string") {
      if (id.startsWith("bank::")) return id;
      if (id.includes("::") && !id.startsWith("bank::")) {
        const parts = id.split("::");
        if (parts.length === 2) return id;
      }
    }
    for (const round of ROUNDS) {
      for (const pos of POSITIONS) {
        if (board[round][pos].includes(id)) return `${round}::${pos}`;
      }
    }
    return getBankContainerForPlayer(id);
  };

  const handleDragStart = (event) => { setActiveId(event.active.id); };

  const toggleMarker = (playerId, key) => {
    setMarkers(prev => {
      const current = prev[playerId] || {};
      return { ...prev, [playerId]: { ...current, [key]: !current[key] } };
    });
    setIsDirty(true);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;
    const activeContainer = findContainer(activeId);
    const overContainer = findContainer(overId);
    if (!activeContainer || !overContainer) return;

    const isBank = (c) => c.startsWith("bank::");

    if (isBank(overContainer)) {
      if (!isBank(activeContainer)) {
        const updated = structuredClone(board);
        const [fromRound, fromPos] = activeContainer.split("::");
        updated[fromRound][fromPos] = updated[fromRound][fromPos].filter(id => id !== activeId);
        setBoard(updated);
        setIsDirty(true);
      }
      return;
    }

    const [toRound, toPos] = overContainer.split("::");
    const player = allPlayers.find(p => p.id === activeId);
    const rawPos = (player?.Position || "").toUpperCase();
    const normalized = (rawPos === "CB" || rawPos === "S") ? "DB" : rawPos;
    if (normalized !== toPos) return;

    const updated = structuredClone(board);

    if (!isBank(activeContainer) && activeContainer === overContainer) {
      const list = updated[toRound][toPos];
      const oldIndex = list.indexOf(activeId);
      let newIndex = overId === overContainer ? list.length - 1 : list.indexOf(overId);
      if (newIndex === -1) newIndex = list.length - 1;
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        updated[toRound][toPos] = arrayMove(list, oldIndex, newIndex);
        setBoard(updated);
        setIsDirty(true);
      }
      return;
    }

    if (!isBank(activeContainer)) {
      const [fromRound, fromPos] = activeContainer.split("::");
      updated[fromRound][fromPos] = updated[fromRound][fromPos].filter(id => id !== activeId);
    }

    const dest = updated[toRound][toPos];
    const insertIndex = dest.indexOf(overId);
    if (overId === overContainer || insertIndex === -1) {
      dest.push(activeId);
    } else {
      dest.splice(insertIndex, 0, activeId);
    }

    setBoard(updated);
    setIsDirty(true);
  };

  const handleSave = async () => {
    if (!user) { alert("You must be logged in to save your board."); return; }
    try {
      await withAuthRetry(() => setDoc(doc(db, "whiteboards", `${user.uid}_${selectedClass}`), {
        uid: user.uid,
        draftClass: selectedClass,
        board,
        markers,
        updatedAt: serverTimestamp()
      }));
      setIsDirty(false);
    } catch (err) {
      console.error("Failed to save whiteboard:", err);
      alert("We couldn't save your board. Please try again in a moment.");
    }
  };

  const assignedIds = useMemo(() => {
    if (!board) return [];
    return Object.values(board).flatMap(r => Object.values(r).flat());
  }, [board]);

  const bankPlayers = useMemo(() => {
    return allPlayers.filter(p => !assignedIds.includes(p.id));
  }, [allPlayers, assignedIds]);

  const dayGroups = useMemo(() => ([
    { label: "Day 1", rounds: ["ROUND 1"] },
    { label: "Day 2", rounds: ["ROUND 2", "ROUND 3"] },
    { label: "Day 3", rounds: ["ROUND 4", "ROUND 5", "ROUND 6", "ROUND 7"] },
    { label: "UDFA", rounds: ["UDFA"] },
  ]), []);

  const dayPositionCounts = useMemo(() => {
    if (!board) return [];
    return dayGroups.map(day => ({
      label: day.label,
      counts: POSITIONS.map(pos =>
        day.rounds.reduce((sum, round) => sum + (board[round]?.[pos]?.length || 0), 0)
      ),
    }));
  }, [board, dayGroups]);

  const unrankedCounts = useMemo(() => {
    return POSITIONS.map(pos =>
      bankPlayers.filter(p => {
        const playerPos = (p.Position || "").toUpperCase();
        if (pos === "DB") return playerPos === "CB" || playerPos === "S" || playerPos === "DB";
        return playerPos === pos;
      }).length
    );
  }, [bankPlayers]);

  const boardStyles = `
    .wb-page { padding: 40px 16px 80px; background: ${SITE_BG}; min-height: 100vh; }
    @media (min-width: 900px) { .wb-page { padding: 56px 60px 100px; } }

    .wb-header-row {
      display: flex; align-items: flex-start; justify-content: flex-start; gap: 20px;
      flex-wrap: wrap; margin-bottom: 32px;
    }

    .wb-mini-board {
      flex: 1 1 60%; min-width: 380px; background: #fff; border-radius: 14px;
      border: 1px solid ${SITE_BORDER}; box-shadow: 0 1px 3px rgba(11,18,32,0.06);
      padding: 14px 16px; overflow-x: auto;
    }
    .wb-side-title {
      font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
      color: #9aa2b1; margin-bottom: 3px;
    }
    .wb-mini-sub { font-size: 10px; color: #9aa2b1; margin-bottom: 10px; }
    .wb-mini-grid { display: grid; grid-template-columns: 42px repeat(9, minmax(28px, 1fr)); gap: 3px; min-width: 360px; }
    .wb-mini-pos-label {
      text-align: center; font-size: 8px; font-weight: 800; color: #fff;
      padding: 3px 2px; border-radius: 4px;
    }
    .wb-mini-day-label {
      display: flex; align-items: center; font-size: 9px; font-weight: 800;
      color: ${SITE_INK};
    }
    .wb-mini-cell {
      display: flex; align-items: center; justify-content: center;
      height: 24px; border-radius: 4px; font-size: 11px; font-weight: 800;
      background: ${SITE_BG}; color: ${SITE_INK};
    }
    .wb-mini-cell.wb-mini-empty { color: #cfd4dc; font-weight: 500; }
    .wb-mini-unranked-label { color: #9aa2b1; border-top: 1px dashed ${SITE_BORDER}; padding-top: 8px; margin-top: 3px; }
    .wb-mini-unranked-cell { background: #fafbfc; color: #9aa2b1; border-top: 1px dashed ${SITE_BORDER}; margin-top: 3px; padding-top: 8px; height: 32px; }

    .wb-header-card {
      flex: 0 1 34%; min-width: 320px; max-width: 460px; background: linear-gradient(155deg, ${SITE_BLUE} 0%, #003b73 100%);
      border-radius: 18px; border: 3px solid ${SITE_GOLD};
      box-shadow: 0 10px 28px rgba(0,58,115,0.28);
      padding: 32px 28px; text-align: center;
    }
    .wb-title { font-size: 24px; font-weight: 800; color: #fff; letter-spacing: -0.02em; margin-bottom: 6px; }
    @media (min-width: 500px) { .wb-title { font-size: 30px; } }
    .wb-subtitle { font-size: 13px; color: rgba(255,255,255,0.75); margin-bottom: 18px; }
    .wb-header-stat {
      display: inline-flex; align-items: baseline; gap: 6px; margin-bottom: 20px;
      background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18);
      border-radius: 999px; padding: 6px 16px;
    }
    .wb-header-stat-num { font-size: 18px; font-weight: 800; color: ${SITE_GOLD}; }
    .wb-header-stat-label { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.8); text-transform: uppercase; letter-spacing: 0.05em; }
    .wb-controls { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; align-items: center; }

    .wb-select {
      appearance: none; padding: 10px 36px 10px 18px; font-size: 15px; font-weight: 700;
      border: 1.5px solid ${SITE_BLUE}; border-radius: 999px; color: ${SITE_BLUE};
      background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%230055a5' stroke-width='2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 16px center;
      cursor: pointer; transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .wb-select:hover { border-color: ${SITE_GOLD}; box-shadow: 0 0 0 3px rgba(246,162,29,0.25); }

    .wb-save-btn {
      display: inline-flex; align-items: center; gap: 8px; padding: 10px 22px;
      border: 1.5px solid transparent; border-radius: 999px; font-weight: 700; font-size: 14px;
      cursor: pointer; transition: transform 0.12s ease, box-shadow 0.12s ease;
    }
    .wb-save-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,0.25); }
    .wb-save-btn:active { transform: translateY(0); }
    .wb-save-dot { width: 8px; height: 8px; border-radius: 50%; }
    .wb-save-dot.pulsing { animation: wb-pulse 1.4s ease-in-out infinite; }
    @keyframes wb-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

    .wb-view-players {
      display: inline-flex; margin: 0 auto 36px; padding: 8px 20px; background: #fff;
      color: ${SITE_BLUE}; border: 1.5px solid ${SITE_BLUE}; border-radius: 999px;
      font-weight: 700; font-size: 13px; cursor: pointer; transition: background 0.15s ease;
    }
    .wb-view-players:hover { background: #eef4fb; }
    .wb-view-players-wrap { display: flex; justify-content: center; }

    .wb-pos-header-wrap {
      position: sticky; top: 60px; z-index: 50; background: ${SITE_BG};
      transition: transform 0.2s ease;
    }
    .wb-pos-header-wrap.wb-pos-header-hidden {
      transform: translateY(-100%);
    }
    .wb-pos-header-scroll {
      overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
    }
    .wb-pos-header-scroll::-webkit-scrollbar { display: none; }
    .wb-pos-header {
      display: grid; grid-template-columns: 84px repeat(9, minmax(150px, 1fr));
      gap: 10px; padding: 14px 0; margin-bottom: 18px; min-width: 1500px;
      border-bottom: 3px solid ${SITE_GOLD};
    }
    .wb-pos-label {
      text-align: center; font-weight: 800; font-size: 14px; letter-spacing: 0.04em;
      color: #fff; padding: 8px 4px; border-radius: 8px;
    }

    .wb-board-scroll { overflow-x: auto; overflow-y: hidden; padding-bottom: 8px; }
    .wb-round-row {
      display: grid; grid-template-columns: 84px repeat(9, minmax(150px, 1fr));
      gap: 10px; margin-bottom: 18px; min-width: 1500px;
    }
    .wb-round-label {
      display: flex; align-items: center; justify-content: center;
      background: ${SITE_INK}; color: #fff; border-radius: 10px;
      font-weight: 800; font-size: 13px; letter-spacing: 0.06em; text-align: center;
      padding: 10px 4px; writing-mode: vertical-rl; transform: rotate(180deg);
    }
    .wb-col {
      min-height: 180px; background: #fff; border: 1.5px dashed ${SITE_BORDER};
      border-radius: 10px; padding: 8px; transition: border-color 0.15s ease, background 0.15s ease;
    }
    .wb-col.wb-col-over { border-color: ${SITE_GOLD}; background: #fff8e9; }

    .wb-bank-wrap { margin-top: 64px; }
    .wb-bank-title {
      text-align: center; font-size: 20px; font-weight: 800; color: ${SITE_INK};
      margin-bottom: 8px; letter-spacing: -0.01em;
    }
    .wb-bank-sub { text-align: center; font-size: 12px; color: #8a93a3; margin-bottom: 24px; }

    .wb-player-card {
      display: flex; align-items: stretch; gap: 0;
      border: 1px solid ${SITE_BORDER}; border-radius: 8px;
      margin-bottom: 6px; background: #fff; overflow: hidden;
      box-shadow: 0 1px 2px rgba(11,18,32,0.04);
      transition: box-shadow 0.12s ease;
    }
    .wb-player-card:hover { box-shadow: 0 4px 10px rgba(11,18,32,0.10); }
    .wb-player-handle {
      flex-shrink: 0; width: 30px; display: flex; align-items: center; justify-content: center;
      cursor: grab; touch-action: none; transition: filter 0.12s ease;
    }
    .wb-player-handle:hover { filter: brightness(1.1); }
    .wb-player-handle:active { cursor: grabbing; }
    .wb-player-handle-icon { color: rgba(255,255,255,0.9); font-size: 16px; line-height: 1; letter-spacing: -1px; }
    .wb-player-body { flex: 1; min-width: 0; padding: 8px 10px; }
    .wb-player-toprow { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
    .wb-player-name-col { min-width: 0; flex: 1; }
    .wb-player-link {
      text-decoration: none; color: ${SITE_INK}; text-align: left;
      display: flex; flex-direction: column; line-height: 1.15;
    }
    .wb-player-link:hover .wb-player-last { color: ${SITE_BLUE}; }
    .wb-player-first { font-weight: 500; opacity: 0.75; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wb-player-last { font-weight: 800; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wb-player-school {
      font-size: 11px; font-style: italic; opacity: 0.6; margin-top: 3px;
      line-height: 13px; text-align: left;
    }
    .wb-player-actions { display: flex; flex-direction: column; align-items: center; gap: 2px; flex-shrink: 0; }
    .wb-icon-btn {
      display: flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; padding: 0; border: none; background: transparent;
      cursor: pointer; font-size: 13px; line-height: 1; color: #c9cdd6;
      transition: transform 0.1s ease, color 0.12s ease;
    }
    .wb-icon-btn:hover { transform: scale(1.15); }
    .wb-icon-btn.wb-star-active { color: ${SITE_GOLD}; }
    .wb-icon-btn.wb-flag-active { color: #d32f2f; }

    .wb-state-page { padding: 100px 24px; text-align: center; }
    .wb-state-card {
      max-width: 420px; margin: 0 auto; background: #fff; border-radius: 16px;
      border: 1px solid ${SITE_BORDER}; padding: 36px 28px; box-shadow: 0 1px 3px rgba(11,18,32,0.06);
    }
  `;

  // Still resolving auth — show nothing yet
  if (!authReady) return null;

  if (!user) {
    return (
      <div className="wb-state-page" style={{ background: SITE_BG, minHeight: "100vh" }}>
        <style>{boardStyles}</style>
        <div className="wb-state-card">
          <h2 style={{ color: SITE_INK, fontSize: 20, margin: 0 }}>Please log in to access your draft board.</h2>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="wb-state-page" style={{ background: SITE_BG, minHeight: "100vh" }}>
        <style>{boardStyles}</style>
        <div className="wb-state-card">
          <h2 style={{ color: SITE_INK, fontSize: 18, margin: 0 }}>{loadError}</h2>
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="wb-state-page" style={{ background: SITE_BG, minHeight: "100vh", color: "#8a93a3" }}>
        <style>{boardStyles}</style>
        Loading your whiteboard...
      </div>
    );
  }

  return (
    <div className="wb-page">
      <style>{boardStyles}</style>

      {/* HEADER */}
      <div className="wb-header-row">

        <div className="wb-header-card">
          <div className="wb-title">
            {(user?.displayName || user?.email?.split("@")[0] || "User")}'s Whiteboard
          </div>
          <div className="wb-subtitle">
            Drag players from the bank below to build your own big board.
          </div>

          <div className="wb-header-stat">
            <span className="wb-header-stat-num">{assignedIds.length}</span>
            <span className="wb-header-stat-label">of {allPlayers.length} ranked</span>
          </div>

          <div className="wb-controls">
            <select
              className="wb-select"
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
            >
              {DRAFT_CLASSES.map(year => (
                <option key={year} value={year}>
                  {year === "2026" ? "2026 (Archive)" : `${year} Class`}
                </option>
              ))}
            </select>

            <button
              className="wb-save-btn"
              onClick={handleSave}
              style={{
                background: isDirty ? "#d32f2f" : SITE_GOLD,
                color: isDirty ? "#fff" : SITE_INK,
              }}
            >
              <span
                className={`wb-save-dot${isDirty ? " pulsing" : ""}`}
                style={{ background: isDirty ? "#fff" : SITE_INK }}
              />
              {isDirty ? "Unsaved changes — save" : "Saved"}
            </button>
          </div>
        </div>

        {/* MINI BOARD — grades given by day / position */}
        <div className="wb-mini-board">
          <div className="wb-side-title">Grades Given</div>
          <div className="wb-mini-sub">Players ranked, by draft day and position</div>
          <div className="wb-mini-grid">
            <div></div>
            {POSITIONS.map(pos => (
              <div key={pos} className="wb-mini-pos-label" style={{ background: POS_COLORS[pos] }}>{pos}</div>
            ))}
            {dayPositionCounts.map(day => (
              <React.Fragment key={day.label}>
                <div className="wb-mini-day-label">{day.label}</div>
                {day.counts.map((count, i) => (
                  <div key={POSITIONS[i]} className={`wb-mini-cell${count === 0 ? " wb-mini-empty" : ""}`}>
                    {count === 0 ? "–" : count}
                  </div>
                ))}
              </React.Fragment>
            ))}
            <div className="wb-mini-day-label wb-mini-unranked-label">Unranked</div>
            {unrankedCounts.map((count, i) => (
              <div key={`unranked-${POSITIONS[i]}`} className={`wb-mini-cell wb-mini-unranked-cell${count === 0 ? " wb-mini-empty" : ""}`}>
                {count === 0 ? "–" : count}
              </div>
            ))}
          </div>
        </div>

      </div>

      <div className="wb-view-players-wrap">
        <button className="wb-view-players" onClick={scrollToPlayers}>
          Jump to player bank ↓
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <DragOverlay>
          {activeId ? (
            <div style={{ padding: "8px 12px", border: `1.5px solid ${SITE_GOLD}`, background: "#fff", fontSize: 13, fontWeight: 700, boxShadow: "0 8px 20px rgba(11,18,32,0.25)", borderRadius: 8, cursor: "grabbing" }}>
              {(() => {
                const player = allPlayers.find(p => p.id === activeId);
                if (!player) return "";
                return `${(player.First || "").charAt(0)}. ${player.Last || ""}`;
              })()}
            </div>
          ) : null}
        </DragOverlay>

        {/* STICKY POSITION HEADER */}
        <div className={`wb-pos-header-wrap${posHeaderHidden ? " wb-pos-header-hidden" : ""}`}>
          <div className="wb-pos-header-scroll" ref={headerScrollRef} onScroll={syncHeaderScroll}>
            <div className="wb-pos-header">
              <div></div>
              {POSITIONS.map(pos => (
                <div key={pos} className="wb-pos-label" style={{ background: POS_COLORS[pos] }}>{pos}</div>
              ))}
            </div>
          </div>
        </div>

        <div className="wb-board-scroll" ref={boardScrollRef} onScroll={syncBodyScroll}>
          {/* ROUNDS */}
          {ROUNDS.map((round) => (
            <div key={round} className="wb-round-row">
              <div className="wb-round-label">{round}</div>
              {POSITIONS.map(pos => (
                <PositionColumn key={`${round}-${pos}`} round={round} pos={pos} playerIds={board[round][pos]} players={allPlayers} markers={markers} onToggleMarker={toggleMarker} />
              ))}
            </div>
          ))}
        </div>

        {/* PLAYER BANK */}
        <div ref={playerBankRef} className="wb-bank-wrap">
          <div className="wb-bank-title">Player Bank</div>
          <div className="wb-bank-sub">Unassigned players, grouped by position</div>
          <div className="wb-board-scroll">
            <div style={{ display: "grid", gridTemplateColumns: "84px repeat(9, minmax(150px, 1fr))", gap: 10, minWidth: 1500 }}>
              <div></div>
              {POSITIONS.map(pos => {
                const playersForPos = bankPlayers
                  .filter(p => {
                    const playerPos = (p.Position || "").toUpperCase();
                    if (pos === "DB") return playerPos === "CB" || playerPos === "S" || playerPos === "DB";
                    return playerPos === pos;
                  })
                  .sort((a, b) => (a.Last || "").localeCompare(b.Last || ""));
                return <BankColumn key={pos} pos={pos} players={playersForPos} markers={markers} onToggleMarker={toggleMarker} />;
              })}
            </div>
          </div>
        </div>
      </DndContext>
    </div>
  );
}

function PositionColumn({ round, pos, playerIds, players, markers, onToggleMarker }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${round}::${pos}` });
  return (
    <div ref={setNodeRef} className={`wb-col${isOver ? " wb-col-over" : ""}`}>
      <SortableContext items={playerIds} strategy={verticalListSortingStrategy}>
        {playerIds.map(id => {
          const player = players.find(p => p.id === id);
          if (!player) return null;
          return <DraggablePlayer key={id} id={id} player={player} marker={markers[id]} onToggleMarker={onToggleMarker} />;
        })}
      </SortableContext>
    </div>
  );
}

function BankColumn({ pos, players, markers, onToggleMarker }) {
  const { setNodeRef, isOver } = useDroppable({ id: `bank::${pos}` });
  return (
    <div ref={setNodeRef} className={`wb-col${isOver ? " wb-col-over" : ""}`}>
      <SortableContext items={players.map(p => p.id)} strategy={verticalListSortingStrategy}>
        {players.map(player => (
          <DraggablePlayer key={player.id} id={player.id} player={player} marker={markers[player.id]} onToggleMarker={onToggleMarker} />
        ))}
      </SortableContext>
    </div>
  );
}

function DraggablePlayer({ id, player, marker, onToggleMarker }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id, data: { playerId: id } });
  const starred = !!marker?.starred;
  const flagged = !!marker?.flagged;

  const playerPos = (player.Position || "").toUpperCase();
  const accent = POS_COLORS[playerPos] || SITE_GOLD;

  const ringColor = flagged ? "#d32f2f" : starred ? SITE_GOLD : SITE_BORDER;
  const ringWidth = flagged || starred ? 2 : 1;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    border: `${ringWidth}px solid ${ringColor}`,
    boxShadow: flagged
      ? "0 0 0 3px rgba(211,47,47,0.15)"
      : starred
      ? "0 0 0 3px rgba(246,162,29,0.2)"
      : undefined,
  };

  return (
    <div ref={setNodeRef} className="wb-player-card" style={style}>
      <div
        className="wb-player-handle"
        style={{ background: accent }}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <span className="wb-player-handle-icon">⠿</span>
      </div>
      <div className="wb-player-body">
        <div className="wb-player-toprow">
          <div className="wb-player-name-col">
            <a
              href={`/player/${player.Slug || player.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="wb-player-link"
            >
              <span className="wb-player-first">{player.First || ""}</span>
              <span className="wb-player-last">{player.Last || ""}</span>
            </a>
            <div className="wb-player-school">
              {player.School || ""}
            </div>
          </div>
          <div className="wb-player-actions">
            <button
              type="button"
              className={`wb-icon-btn${starred ? " wb-star-active" : ""}`}
              onClick={() => onToggleMarker(id, "starred")}
              aria-label={starred ? "Unstar player" : "Star player"}
              title={starred ? "Unstar" : "Star"}
            >
              ★
            </button>
            <button
              type="button"
              className={`wb-icon-btn${flagged ? " wb-flag-active" : ""}`}
              onClick={() => onToggleMarker(id, "flagged")}
              aria-label={flagged ? "Remove red flag" : "Red flag player"}
              title={flagged ? "Remove flag" : "Flag"}
            >
              ⚑
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}