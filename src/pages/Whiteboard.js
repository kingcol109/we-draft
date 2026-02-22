import React, { useEffect, useMemo, useState } from "react";
import { DndContext, closestCenter, DragOverlay, useDroppable, useSensor, useSensors, PointerSensor } from "@dnd-kit/core";

import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { useAuth } from "../context/AuthContext";

import { CSS } from "@dnd-kit/utilities";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  setDoc,
  serverTimestamp
} from "firebase/firestore";
import { db } from "../firebase";
import { useRef } from "react";
/* ====================== */

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

const POSITIONS = ["QB","RB","WR","TE","OL","DL","EDGE","LB","DB"];
const ROUNDS = ["ROUND 1","ROUND 2","ROUND 3","ROUND 4","ROUND 5","ROUND 6","ROUND 7","UDFA"];
const DRAFT_CLASSES = ["2026","2027","2028"];

export default function Whiteboard() {
const { user } = useAuth();
  const [selectedClass, setSelectedClass] = useState("2026");
  const [allPlayers, setAllPlayers] = useState([]);
const [board, setBoard] = useState(null);
const [isDirty, setIsDirty] = useState(false);
const [activeId, setActiveId] = useState(null);
const playerBankRef = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor));
const scrollToPlayers = () => {
  playerBankRef.current?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
};
  /* ======================
     LOAD PLAYERS BY CLASS
  ====================== */
  useEffect(() => {
    const loadPlayers = async () => {
      const snap = await getDocs(collection(db, "players"));
      const players = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => p.Eligible === selectedClass);

      setAllPlayers(players);
    };

    loadPlayers();
  }, [selectedClass]);

  /* ======================
     INIT EMPTY BOARD
  ====================== */
useEffect(() => {
  if (!allPlayers.length || !user) return;

  const loadBoard = async () => {
    const boardRef = doc(
      db,
      "whiteboards",
      `${user.uid}_${selectedClass}`
    );

    const snap = await getDoc(boardRef);

    if (snap.exists()) {
      setBoard(snap.data().board);
    } else {
      const empty = {};
      ROUNDS.forEach(r => {
        empty[r] = {};
        POSITIONS.forEach(p => {
          empty[r][p] = [];
        });
      });
      setBoard(empty);
    }
  };

  loadBoard();
}, [allPlayers, selectedClass, user]);
useEffect(() => {
  const handleBeforeUnload = (e) => {
    if (!isDirty) return;

    e.preventDefault();
    e.returnValue = "";
  };

  window.addEventListener("beforeunload", handleBeforeUnload);

  return () => {
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };
}, [isDirty]);
  /* ======================
     DRAG LOGIC
  ====================== */
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

  // If the id itself is a container id (round::pos or bank::pos), return it
  if (typeof id === "string") {
    if (id.startsWith("bank::")) return id;
    if (id.includes("::") && !id.startsWith("bank::")) {
      const parts = id.split("::");
      if (parts.length === 2) return id; // round::pos
    }
  }

  // Look through board for a player id
  for (const round of ROUNDS) {
    for (const pos of POSITIONS) {
      if (board[round][pos].includes(id)) {
        return `${round}::${pos}`;
      }
    }
  }

  // If not in board, it’s in bank (by definition in this app)
  return getBankContainerForPlayer(id);
};

const handleDragStart = (event) => {
  setActiveId(event.active.id);
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

  // If dropping into bank: remove from board (if needed) and stop
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

  // Destination is a board container
  const [toRound, toPos] = overContainer.split("::");

  // Enforce position lock (CB/S allowed into DB)
  const player = allPlayers.find(p => p.id === activeId);
  const rawPos = (player?.Position || "").toUpperCase();
  const normalized = (rawPos === "CB" || rawPos === "S") ? "DB" : rawPos;

  if (normalized !== toPos) {
    return; // snap back
  }

  const updated = structuredClone(board);

  // SAME COLUMN REORDER (this is the bug fix)
  if (!isBank(activeContainer) && activeContainer === overContainer) {
    const list = updated[toRound][toPos];
    const oldIndex = list.indexOf(activeId);

    // If you're dragging into empty space / below last item, overId can be the container id
    let newIndex;
    if (overId === overContainer) {
      newIndex = list.length - 1; // move to bottom
    } else {
      newIndex = list.indexOf(overId);
      if (newIndex === -1) newIndex = list.length - 1;
    }

    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      updated[toRound][toPos] = arrayMove(list, oldIndex, newIndex);
      setBoard(updated);
      setIsDirty(true);
    }

    return;
  }

  // MOVE ACROSS COLUMNS (or from bank to board)
  // Remove from source board column if it was on the board
  if (!isBank(activeContainer)) {
    const [fromRound, fromPos] = activeContainer.split("::");
    updated[fromRound][fromPos] = updated[fromRound][fromPos].filter(id => id !== activeId);
  }

  const dest = updated[toRound][toPos];

  // If dropped on a player, insert before them. If dropped on container, append.
  const insertIndex = dest.indexOf(overId);
  if (overId === overContainer || insertIndex === -1) {
    dest.push(activeId);
  } else {
    dest.splice(insertIndex, 0, activeId);
  }

  setBoard(updated);
  setIsDirty(true);
};




  /* ======================
     SAVE
  ====================== */
const handleSave = async () => {
  if (!user) {
    alert("You must be logged in to save your board.");
    return;
  }

  const boardId = `${user.uid}_${selectedClass}`;

  await setDoc(doc(db, "whiteboards", boardId), {
    userId: user.uid,
    draftClass: selectedClass,
    board,
    updatedAt: serverTimestamp()
  });

  setIsDirty(false);
};
  /* ======================
     PLAYER BANK
  ====================== */
  const assignedIds = useMemo(() => {
    if (!board) return [];
    return Object.values(board)
      .flatMap(r => Object.values(r).flat());
  }, [board]);

  const bankPlayers = useMemo(() => {
    return allPlayers.filter(p => !assignedIds.includes(p.id));
  }, [allPlayers, assignedIds]);
if (!user) {
  return (
    <div style={{ padding: 100, textAlign: "center" }}>
      <h2>Please log in to access your draft board.</h2>
    </div>
  );
}
  if (!board) return null;

  return (
    <div style={{ padding: "60px 140px", background: "#fafafa" }}>

{/* HEADER */}
<div
  style={{
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginBottom: 50
  }}
>
<div
  style={{
    fontSize: 34,
    fontWeight: 900,
    color: SITE_BLUE,
    marginBottom: 6
  }}
>
  {(user?.displayName || user?.email?.split("@")[0] || "User")}'s Whiteboard
</div>

<div
  style={{
    fontSize: 14,
    color: "#666",
    marginBottom: 18,
    textAlign: "center"
  }}
>
  Drag players from the bottom and create your own player rankings!
</div>

  <select
    value={selectedClass}
    onChange={(e) => setSelectedClass(e.target.value)}
    style={{
      padding: "10px 18px",
      fontSize: 18,
      fontWeight: 600,
      border: `2px solid ${SITE_GOLD}`,
      borderRadius: 6,
      color: SITE_BLUE,
      background: "#fff",
      cursor: "pointer"
    }}
  >
    {DRAFT_CLASSES.map(year => (
      <option key={year} value={year}>
        {year}
      </option>
    ))}
  </select>

  <button
    onClick={handleSave}
    style={{
      marginTop: 20,
      background: isDirty ? "#d32f2f" : SITE_BLUE,
      color: "#fff",
      padding: "12px 28px",
      border: "none",
      borderRadius: 6,
      fontWeight: "bold",
      cursor: "pointer",
      fontSize: 15
    }}
  >
    
    {isDirty ? "UNSAVED CHANGES — CLICK TO SAVE" : "Saved"}
  </button>
</div>
<button
  onClick={scrollToPlayers}
  style={{
    marginTop: 12,
    background: "#fff",
    color: SITE_BLUE,
    padding: "8px 22px",
    border: `2px solid ${SITE_BLUE}`,
    borderRadius: 6,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 14
  }}
>
  VIEW PLAYERS
</button>
<DndContext
  sensors={sensors}
  collisionDetection={closestCenter}
  onDragStart={handleDragStart}
  onDragEnd={handleDragEnd}
>
<DragOverlay>
  {activeId ? (
    <div
      style={{
        padding: "6px 10px",
        border: "1px solid #ccc",
        background: "#fff",
        fontSize: 14,
        boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
        borderRadius: 4,
        cursor: "grabbing"
      }}
    >
      {(() => {
        const player = allPlayers.find(p => p.id === activeId);
        if (!player) return "";
        return `${(player.First || "").charAt(0)}. ${player.Last || ""}`;
      })()}
    </div>
  ) : null}
</DragOverlay>


{/* STICKY POSITION HEADER */}
<div
  style={{
    position: "sticky",
    top: 0,
    zIndex: 50,
    background: "#fafafa",
    display: "grid",
    gridTemplateColumns: `120px repeat(${POSITIONS.length}, 1fr)`,
    paddingBottom: 20,
    marginBottom: 25,
    borderBottom: `3px solid ${SITE_GOLD}`
  }}
>
  <div></div>
  {POSITIONS.map(pos => (
    <div
      key={pos}
      style={{
        textAlign: "center",
        fontWeight: "900",
        fontSize: 24,
        color: SITE_BLUE
      }}
    >
      {pos}
    </div>
  ))}
</div>


        {/* ROUNDS */}
        {ROUNDS.map(round => (
          <div
            key={round}
            style={{
              display: "grid",
              gridTemplateColumns: `120px repeat(${POSITIONS.length}, 1fr)`,
              marginBottom: 40
            }}
          >
            <div style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              fontSize: 26,
              fontWeight: "900",
              color: SITE_BLUE,
              textAlign: "center"
            }}>
              {round}
            </div>

            {POSITIONS.map(pos => (
              <PositionColumn
                key={`${round}-${pos}`}
                round={round}
                pos={pos}
                playerIds={board[round][pos]}
                players={allPlayers}
              />
            ))}
          </div>
        ))}

{/* PLAYER BANK */}
<div ref={playerBankRef} style={{ marginTop: 100 }}>

          <div style={{
            textAlign: "center",
            fontSize: 26,
            fontWeight: "900",
            color: SITE_BLUE,
            marginBottom: 35
          }}>
            PLAYER BANK
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: `120px repeat(${POSITIONS.length}, 1fr)`
          }}>
            <div></div>

            {POSITIONS.map(pos => {

              const playersForPos = bankPlayers
                .filter(p => {
                  const playerPos = (p.Position || "").toUpperCase();
                  if (pos === "DB") {
                    return playerPos === "CB" || playerPos === "S" || playerPos === "DB";
                  }
                  return playerPos === pos;
                })
                .sort((a, b) =>
                  (a.Last || "").localeCompare(b.Last || "")
                );

              return (
                <BankColumn
                  key={pos}
                  pos={pos}
                  players={playersForPos}
                />
              );
            })}
          </div>
        </div>

      </DndContext>
    </div>
  );
}

/* ======================
   POSITION COLUMN
====================== */
function PositionColumn({ round, pos, playerIds, players }) {

  const { setNodeRef } = useDroppable({
    id: `${round}::${pos}`
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 190,
        background: "#fff",
        border: `2px solid ${SITE_GOLD}`,
        padding: 10
      }}
    >
      <SortableContext
        items={playerIds}
        strategy={verticalListSortingStrategy}
      >
        {playerIds.map(id => {
          const player = players.find(p => p.id === id);
          if (!player) return null;

          return (
            <DraggablePlayer
              key={id}
              id={id}
              player={player}
            />
          );
        })}
      </SortableContext>
    </div>
  );
}

/* ======================
   BANK COLUMN
====================== */
function BankColumn({ pos, players }) {

  const { setNodeRef } = useDroppable({
    id: `bank::${pos}`
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 190,
        background: "#fff",
        border: `2px solid ${SITE_GOLD}`,
        padding: 10
      }}
    >
      <SortableContext
        items={players.map(p => p.id)}
        strategy={verticalListSortingStrategy}
      >
        {players.map(player => (
          <DraggablePlayer
            key={player.id}
            id={player.id}
            player={player}
          />
        ))}
      </SortableContext>
    </div>
  );
}

/* ======================
   DRAGGABLE PLAYER
====================== */
function DraggablePlayer({ id, player }) {

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition
  } = useSortable({
    id,
    data: { playerId: id }
  });

  /* ======================
     POSITION COLORS
  ====================== */

  const POS_COLORS = {
    QB: "#4169E1",   // royal blue
    RB: "#D32F2F",   // red
    WR: "#2E7D32",   // green
    TE: "#F57C00",   // orange
    OL: "#FBC02D",   // yellow
    EDGE: "#8E24AA", // purple
    DL: "#0097A7",   // teal
    LB: "#0D47A1",   // navy
    DB: "#EC407A"    // pink
  };

  const playerPos = (player.Position || "").toUpperCase();
  const accent = POS_COLORS[playerPos] || SITE_GOLD;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    padding: "12px 14px",
    border: "1px solid #ddd",
    borderLeft: `6px solid ${accent}`,
    marginBottom: 6,
    background: "#fff",
    borderRadius: 6,
    cursor: "grab",
boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
  };

  const displayName =
    `${(player.First || "").charAt(0)}. ${player.Last || ""}`;

return (
  <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
    <a
      href={`/player/${player.Slug || player.slug}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        textDecoration: "none",
        color: SITE_BLUE,
        fontWeight: 800,
        fontSize: 14,
        lineHeight: "16px",
        display: "block",
        textAlign: "center"
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {displayName}
    </a>

    <div
      style={{
        fontSize: 9,
        fontStyle: "italic",
        opacity: 0.6,
        marginTop: 2,
        lineHeight: "11px",
        textAlign: "center"
      }}
    >
      {player.School || ""}
    </div>
  </div>
);
}