// src/pages/Whiteboard.js — /whiteboard
//
// A user's own draft board for one class: every prospect placed in a round
// (Round 1 … UDFA) under his position group, starred or red-flagged, saved
// to whiteboards/{uid}_{class}. Unplaced players sit in the Player Bank.
//
// Three kinds of view (the tabs):
//   - "Whiteboard" (desktop only): the classic grid — rounds down, the nine
//     position groups across, with a sticky position header.
//   - "Big Board": every position ranked together, round by round — one
//     list per round, numbered overall, with the whole bank below. The
//     cross-position order is saved as bigBoard ({ round: [ids] }); within
//     a position it always follows that position's own order (bigLists
//     below keeps the two in step), so reordering in either view shows up
//     in the other.
//   - one position group: that group's rounds as full-width rows of cards,
//     its bank below. Phones get these and the Big Board; nothing scrolls
//     sideways.
// A past class (LOCKED_CLASSES — its draft is done) opens view-only: no
// dragging, no round menu, no star / flag changes, no clearing, adding or
// saving. Sharing still works.
//
// Players move by dragging the colored handle (labelled with the
// position), or by tapping it: a menu of rounds (and Bank) opens. Each card
// shows the user's own grade (users/{uid}/evaluations); a school name that
// won't fit falls back to its short name (schools/{School}.Short). The bank
// sorts by grade (then last name) or A–Z, and "Add graded" places every
// graded player in it at his grade's round, best grade first.
//
// Clearing: "Clear board" empties every round (and every star/flag);
// each position group's ✕ / "Clear {POS}" empties just that group. Both
// ask first, and an Undo bar follows; nothing is written until Save.
//
// Sharing: "Share graphic" (the hero) and "Share {POS}" (a group's head)
// open ShareGraphicDialog: a group's Top 5, Top 10 or full list as a PNG
// (utils/whiteboardGraphic.js), from the board as it stands, saved or not —
// or a themed list (utils/whiteboardLists.js: Risers, Fallers, Late Round
// Gems, Sleepers, Safe Picks, Busts) of players the user picks, starting
// from suggestions; no grades on those. "Save to account" keeps one in
// users/{uid}/savedGraphics (utils/savedGraphics.js; the profile's Boards
// tab lists them). Each Save also records the board's order for the day
// in `history`, which Risers / Fallers compare with.
// Phones get the share sheet with the image; elsewhere Download and Copy.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DndContext, closestCenter, pointerWithin, DragOverlay, useDroppable, useSensor, useSensors, PointerSensor } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, rectSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { useAuth } from "../context/AuthContext";
import { CSS } from "@dnd-kit/utilities";
import { collection, getDocs, getDoc, doc, setDoc, serverTimestamp, query, where } from "firebase/firestore";
import { db } from "../firebase";
import LoadingSpinner from "../components/LoadingSpinner";
import { getPageScale, unzoomTransform, cssRect, viewportCssWidth, viewportCssHeight } from "../utils/pageZoom";
import { GRAPHIC_MODES } from "../utils/whiteboardGraphic";
import { WB_LISTS, listInfo, listTitles, listPills, movesFrom, nextHistory, pickBaseline } from "../utils/whiteboardLists";
import { renderGraphic, saveGraphic } from "../utils/savedGraphics";
import { statsDay } from "../utils/draftSim/stats";
import ShareSheet, { ShareChips, ShareImagePreview } from "../components/ShareSheet";
import { claimSharePrompt } from "../utils/sharePrompt";
import { GRADE_SCALE, gradeLook } from "../utils/gradeScale";

const SITE_BLUE = "#0055a5";
const SITE_NAVY = "#003b73";
const SITE_GOLD = "#f6a21d";
const SITE_INK = "#0b1220";
const SITE_BORDER = "#e6e9ef";
const SITE_BG = "#f5f7fb";
const FLAG_RED = "#d32f2f";

const POSITIONS = ["QB","RB","WR","TE","OL","DL","EDGE","LB","DB"];
const ROUNDS = ["ROUND 1","ROUND 2","ROUND 3","ROUND 4","ROUND 5","ROUND 6","ROUND 7","UDFA"];
const DRAFT_CLASSES = ["2027","2028","2026"];
const LOCKED_CLASSES = ["2026"];

const POS_COLORS = {
  QB: "#4169E1", RB: "#D32F2F", WR: "#2E7D32", TE: "#F57C00",
  OL: "#B08D00", EDGE: "#8E24AA", DL: "#0097A7", LB: "#0D47A1", DB: "#EC407A"
};

// What a drag is over: whatever is under the pointer (a card first, then
// its round), else the nearest by center. Center-only picked a nearby
// round's card over an empty, full-width round right under the pointer.
const collision = (args) => {
  const hits = pointerWithin(args);
  if (hits.length) return [hits.find((h) => !String(h.id).includes("::")) || hits[0]];
  return closestCenter(args);
};

const DAY_GROUPS = [
  { label: "Day 1", rounds: ["ROUND 1"] },
  { label: "Day 2", rounds: ["ROUND 2", "ROUND 3"] },
  { label: "Day 3", rounds: ["ROUND 4", "ROUND 5", "ROUND 6", "ROUND 7"] },
  { label: "UDFA", rounds: ["UDFA"] },
];

// A player's position group on the board (CB and S play in DB).
const groupOf = (p) => {
  const raw = (p?.Position || "").toUpperCase();
  return raw === "CB" || raw === "S" ? "DB" : raw;
};

// Bank order: the user's grade (Early 1st … UDFA, then Watchlist, then
// ungraded), then last name, then first.
const gradeRank = (g) => (GRADE_SCALE[g] ?? (g === "Watchlist" ? 11 : 12));
const bankSort = (grades) => (a, b) => gradeRank(grades[a.id]) - gradeRank(grades[b.id])
  || (a.Last || "").localeCompare(b.Last || "") || (a.First || "").localeCompare(b.First || "");

const alphaSort = (a, b) => (a.Last || "").localeCompare(b.Last || "") || (a.First || "").localeCompare(b.First || "");

// "Add graded": the round each grade goes to (a Watchlist grade stays put).
const ROUND_FOR_GRADE = {
  "Early First Round": "ROUND 1", "Middle First Round": "ROUND 1", "Late First Round": "ROUND 1",
  "Second Round": "ROUND 2", "Third Round": "ROUND 3", "Fourth Round": "ROUND 4", "Fifth Round": "ROUND 5",
  "Sixth Round": "ROUND 6", "Seventh Round": "ROUND 7", "UDFA": "UDFA",
};

// Where the round menu goes for a handle: under it, or above when there's
// no room below; kept inside the viewport.
function placeMenu(el) {
  const r = cssRect(el);
  const w = 168;
  const h = 40 * (ROUNDS.length + 1) + 40;
  const left = Math.max(8, Math.min(r.left, viewportCssWidth() - w - 8));
  const below = r.bottom + 6;
  const top = below + h > viewportCssHeight() - 8 ? Math.max(8, r.top - h - 6) : below;
  return { left, top };
}

const emptyBoard = () => {
  const b = {};
  ROUNDS.forEach((r) => { b[r] = {}; POSITIONS.forEach((p) => { b[r][p] = []; }); });
  return b;
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

function useIsMobile(query = "(max-width: 760px)") {
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setM(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [query]);
  return m;
}

export default function Whiteboard() {
  const { user, profile, authReady } = useAuth();
  // The site username (profile.username) names the board and the graphics;
  // without one it's just "My Board" / "MY TOP 5".
  const username = profile?.username?.trim() || "";
  const isMobile = useIsMobile();
  const [selectedClass, setSelectedClass] = useState("2027");
  const [allPlayers, setAllPlayers] = useState([]);
  const [board, setBoard] = useState(null);
  const [markers, setMarkers] = useState({});
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // "ALL" (the Whiteboard grid, desktop), "BIG" (the Big Board) or one
  // position group.
  const [view, setView] = useState("ALL");
  // The Big Board's cross-position order: { round: [playerIds] }.
  const [bigOrder, setBigOrder] = useState({});
  // Board history for risers / fallers (utils/whiteboardLists.js): the saved
  // history ({ day: "id,id,…" }) and the board as it loaded ({ day, order }).
  const [history, setHistory] = useState({});
  const [loadedSnap, setLoadedSnap] = useState(null);
  // The user's own grades: { playerId: grade label }.
  const [grades, setGrades] = useState({});
  // The Big Board bank's position filter.
  const [bigBankPos, setBigBankPos] = useState("ALL");
  // Bank order: "grade" (the user's grade, then last name) or "alpha".
  const [bankOrder, setBankOrder] = useState("grade");
  // Schools' short names, for chips whose full school name won't fit.
  const [shortOf, setShortOf] = useState({});
  // School logos (schools/{School}.Logo1, the light-background one) for the
  // wide chips.
  const [logoOf, setLogoOf] = useState({});
  // The round menu a tap on a chip's handle opens: { id, left, top }.
  const [roundMenu, setRoundMenu] = useState(null);
  // The last clear, for Undo: { label, board, markers, bigOrder, wasDirty }.
  const [undo, setUndo] = useState(null);
  const undoTimer = useRef(null);
  const playerBankRef = useRef(null);
  const headerScrollRef = useRef(null);
  const boardScrollRef = useRef(null);
  // The share dialog's position group, or null when it's closed.
  const [sharePos, setSharePos] = useState(null);
  // The dialog was opened by the "share it?" after Save, not a click.
  const [sharePrompted, setSharePrompted] = useState(false);
  // A small move before a drag starts, so a tap on the handle isn't a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Phones only get the single-group view.
  const focus = isMobile && view === "ALL" ? "QB" : view;

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
          const d = snap.data();
          setBoard({ ...emptyBoard(), ...d.board });
          setMarkers(d.markers || {});
          setBigOrder(d.bigBoard || {});
          setHistory(d.history || {});
          const order = ROUNDS.flatMap((r) => (d.bigBoard?.[r]?.length ? d.bigBoard[r] : POSITIONS.flatMap((pos) => d.board?.[r]?.[pos] || [])));
          setLoadedSnap(d.updatedAt?.toDate ? { day: statsDay(d.updatedAt.toDate()), order } : null);
        } else {
          setBoard(emptyBoard());
          setMarkers({});
          setBigOrder({});
          setHistory({});
          setLoadedSnap(null);
        }
        setIsDirty(false);
        setUndo(null);
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

  useEffect(() => () => clearTimeout(undoTimer.current), []);

  // Short school names for this class's schools (schools/{School}.Short).
  useEffect(() => {
    const schools = [...new Set(allPlayers.map((p) => p.School).filter(Boolean))].filter((sc) => !(sc in shortOf));
    if (!schools.length) return undefined;
    let live = true;
    (async () => {
      const out = {};
      const logos = {};
      for (let i = 0; i < schools.length; i += 30) {
        const snap = await getDocs(query(collection(db, "schools"), where("School", "in", schools.slice(i, i + 30)))).catch(() => null);
        (snap?.docs || []).forEach((d) => {
          const x = d.data();
          if (x.School && x.Short && x.Short !== x.School) out[x.School] = x.Short;
          if (x.School && (x.Logo1 || x.LogoBlack)) logos[x.School] = x.Logo1 || x.LogoBlack;
        });
      }
      schools.forEach((sc) => { if (!(sc in out)) out[sc] = ""; });
      if (live) { setShortOf((prev) => ({ ...prev, ...out })); setLogoOf((prev) => ({ ...prev, ...logos })); }
    })();
    return () => { live = false; };
  }, [allPlayers]); // eslint-disable-line react-hooks/exhaustive-deps

  // The round menu follows its chip as the page scrolls (a phone's address
  // bar showing or hiding scrolls too, so closing on scroll would snap it
  // shut under the user's finger); Escape or a resize closes it.
  const menuOpen = !!roundMenu;
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = () => setRoundMenu(null);
    const follow = () => setRoundMenu((m) => (m && m.el?.isConnected ? { ...m, ...placeMenu(m.el) } : null));
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("scroll", follow); window.removeEventListener("resize", close); };
  }, [menuOpen]);

  // The user's grades, for the chips and the bank's order.
  useEffect(() => {
    if (!authReady || !user) return undefined;
    let live = true;
    withAuthRetry(() => getDocs(collection(db, "users", user.uid, "evaluations")))
      .then((snap) => {
        if (!live) return;
        const g = {};
        snap.docs.forEach((d) => { if (d.data().grade) g[d.id] = d.data().grade; });
        setGrades(g);
      })
      .catch((e) => console.error("Whiteboard grades:", e));
    return () => { live = false; };
  }, [user, authReady]);

  const playerById = useMemo(() => new Map(allPlayers.map((p) => [p.id, p])), [allPlayers]);

  const findContainer = (id) => {
    if (!board) return null;
    if (typeof id === "string" && id.includes("::")) return id;
    if (focus === "BIG") {
      const r = ROUNDS.find((round) => POSITIONS.some((pos) => board[round][pos].includes(id)));
      return r ? `big::${r}` : "bank::ALL";
    }
    for (const round of ROUNDS) {
      for (const pos of POSITIONS) {
        if (board[round][pos].includes(id)) return `${round}::${pos}`;
      }
    }
    const g = groupOf(playerById.get(id));
    return POSITIONS.includes(g) ? `bank::${g}` : null;
  };

  const handleDragStart = (event) => { setActiveId(event.active.id); };

  const locked = LOCKED_CLASSES.includes(selectedClass);

  const toggleMarker = (playerId, key) => {
    if (locked) return;
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

    if (focus === "BIG") { dropOnBigBoard(activeId, overId, activeContainer, overContainer); return; }

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
    if (groupOf(playerById.get(activeId)) !== toPos) return;

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
    if (roundOf[activeId] !== toRound) arriveInRound(activeId, toRound);
    setIsDirty(true);
  };

  // A Big Board drop: into a round's list at the card it lands on (or the
  // end), or back to the bank. The round's whole list is then written back
  // both ways — as its bigOrder and as each position's order in that round.
  const dropOnBigBoard = (activeId, overId, activeContainer, overContainer) => {
    const pos = groupOf(playerById.get(activeId));
    if (!POSITIONS.includes(pos)) return;
    const updated = structuredClone(board);
    const order = { ...bigOrder };
    const fromRound = activeContainer.startsWith("big::") ? activeContainer.slice(5) : null;
    const writeRound = (round, list) => {
      order[round] = list;
      POSITIONS.forEach((p) => { updated[round][p] = list.filter((id) => groupOf(playerById.get(id)) === p); });
    };
    if (overContainer.startsWith("bank::")) {
      if (!fromRound) return;
      writeRound(fromRound, bigLists[fromRound].filter((id) => id !== activeId));
    } else {
      const toRound = overContainer.slice(5);
      if (fromRound === toRound) {
        const list = bigLists[toRound];
        const oldIndex = list.indexOf(activeId);
        let newIndex = overId === overContainer ? list.length - 1 : list.indexOf(overId);
        if (newIndex === -1) newIndex = list.length - 1;
        if (oldIndex === newIndex) return;
        writeRound(toRound, arrayMove(list, oldIndex, newIndex));
      } else {
        if (fromRound) writeRound(fromRound, bigLists[fromRound].filter((id) => id !== activeId));
        const list = bigLists[toRound].filter((id) => id !== activeId);
        const at = overId === overContainer ? -1 : list.indexOf(overId);
        if (at === -1) list.push(activeId); else list.splice(at, 0, activeId);
        writeRound(toRound, list);
      }
    }
    setBoard(updated);
    setBigOrder(order);
    setIsDirty(true);
  };

  // A player arriving in a round (from the bank or another round) goes to
  // the end of that round's Big Board list; "" takes him off it.
  const arriveInRound = (playerId, round) => {
    setBigOrder((prev) => {
      const next = {};
      ROUNDS.forEach((r) => { next[r] = (r === round ? (bigLists[r] || []) : (prev[r] || [])).filter((id) => id !== playerId); });
      if (round) next[round].push(playerId);
      return next;
    });
  };

  // The round menu on a card: to the end of that round, or "" → the bank.
  const moveTo = (playerId, round) => {
    if (locked) return;
    const pos = groupOf(playerById.get(playerId));
    if (!POSITIONS.includes(pos)) return;
    const updated = structuredClone(board);
    ROUNDS.forEach((r) => { updated[r][pos] = updated[r][pos].filter((id) => id !== playerId); });
    if (round) updated[round][pos].push(playerId);
    setBoard(updated);
    if (roundOf[playerId] !== round) arriveInRound(playerId, round);
    setIsDirty(true);
  };

  const rememberForUndo = (label) => {
    clearTimeout(undoTimer.current);
    setUndo({ label, board, markers, bigOrder, wasDirty: isDirty });
    undoTimer.current = setTimeout(() => setUndo(null), 10000);
  };

  const clearAll = () => {
    if (!assignedIds.length && !Object.keys(markers).length) return;
    if (!window.confirm(`Clear your whole ${selectedClass} whiteboard?\n\nEvery player goes back to the Player Bank and every star and flag is removed. You can undo this until you leave the page; nothing is saved until you press Save.`)) return;
    rememberForUndo("Board cleared");
    setBoard(emptyBoard());
    setMarkers({});
    setBigOrder({});
    setIsDirty(true);
  };

  const clearPosition = (pos) => {
    const placed = ROUNDS.reduce((n, r) => n + board[r][pos].length, 0);
    const ids = new Set(allPlayers.filter((p) => groupOf(p) === pos).map((p) => p.id));
    const marked = Object.keys(markers).filter((id) => ids.has(id));
    if (!placed && !marked.length) return;
    if (!window.confirm(`Clear your ${pos} group?\n\nAll ${placed} placed ${pos}${placed === 1 ? "" : "s"} go back to the Player Bank and their stars and flags are removed. The other positions stay as they are.`)) return;
    rememberForUndo(`${pos} cleared`);
    const updated = structuredClone(board);
    ROUNDS.forEach((r) => { updated[r][pos] = []; });
    setBoard(updated);
    setMarkers((prev) => {
      const next = { ...prev };
      marked.forEach((id) => { delete next[id]; });
      return next;
    });
    setIsDirty(true);
  };

  // "Add graded": every graded player in these bank players goes to his
  // grade's round (Early / Middle / Late 1st → Round 1, … UDFA), after
  // whoever's there, best grade first, then by last name. Watchlist and
  // ungraded players stay in the bank.
  const addGraded = (bankPlayers, label) => {
    const toAdd = bankPlayers.filter((p) => ROUND_FOR_GRADE[grades[p.id]]).sort(bankSort(grades));
    if (!toAdd.length) return;
    if (!window.confirm(`Add ${toAdd.length} graded player${toAdd.length === 1 ? "" : "s"} from ${label} to your board?\n\nEach goes to the round you graded him: Early, Middle and Late 1st in Round 1 (in that order), 2nd in Round 2, and so on, after the players already there. Watchlist and ungraded players stay in the bank.`)) return;
    rememberForUndo(`${toAdd.length} graded player${toAdd.length === 1 ? "" : "s"} added`);
    const updated = structuredClone(board);
    const order = Object.fromEntries(ROUNDS.map((r) => [r, [...(bigLists[r] || [])]]));
    toAdd.forEach((pl) => {
      const r = ROUND_FOR_GRADE[grades[pl.id]];
      updated[r][groupOf(pl)].push(pl.id);
      order[r].push(pl.id);
    });
    setBoard(updated);
    setBigOrder(order);
    setIsDirty(true);
  };

  // A tap on a chip's handle: the round menu, just under it (above it when
  // there's no room below).
  const openRoundMenu = (id, el) => setRoundMenu({ id, el, ...placeMenu(el) });

  const undoClear = () => {
    if (!undo) return;
    clearTimeout(undoTimer.current);
    setBoard(undo.board);
    setMarkers(undo.markers);
    setBigOrder(undo.bigOrder || {});
    setIsDirty(undo.wasDirty);
    setUndo(null);
  };

  const handleSave = async () => {
    if (!user) { alert("You must be logged in to save your board."); return; }
    setSaving(true);
    try {
      const nextHist = nextHistory(history, { loadedDay: loadedSnap?.day, loadedOrder: loadedSnap?.order, today: statsDay(), order: ROUNDS.flatMap((r) => bigLists[r] || []) });
      await withAuthRetry(() => setDoc(doc(db, "whiteboards", `${user.uid}_${selectedClass}`), {
        uid: user.uid,
        draftClass: selectedClass,
        board,
        markers,
        bigBoard: bigLists,
        history: nextHist,
        updatedAt: serverTimestamp()
      }));
      setHistory(nextHist);
      setIsDirty(false);
      // Offer to share it — once a day (utils/sharePrompt.js) — when
      // there's anything on the board to show.
      if (assignedIds.length && claimSharePrompt(user.uid, profile)) {
        setSharePrompted(true);
        setSharePos(POSITIONS.includes(focus) && placedByPos[focus] ? focus : "ALL");
      }
    } catch (err) {
      console.error("Failed to save whiteboard:", err);
      alert("We couldn't save your board. Please try again in a moment.");
    } finally {
      setSaving(false);
    }
  };

  const changeClass = (year) => {
    if (year === selectedClass) return;
    if (isDirty && !window.confirm("You have unsaved changes on this board. Switch classes and lose them?")) return;
    setBoard(null);
    setAllPlayers([]);
    setSelectedClass(year);
  };

  const assignedIds = useMemo(() => {
    if (!board) return [];
    return Object.values(board).flatMap(r => Object.values(r).flat());
  }, [board]);
  const assignedSet = useMemo(() => new Set(assignedIds), [assignedIds]);

  const bankByPos = useMemo(() => {
    const out = Object.fromEntries(POSITIONS.map((p) => [p, []]));
    allPlayers.forEach((p) => { const g = groupOf(p); if (out[g] && !assignedSet.has(p.id)) out[g].push(p); });
    POSITIONS.forEach((pos) => out[pos].sort(bankOrder === "alpha" ? alphaSort : bankSort(grades)));
    return out;
  }, [allPlayers, assignedSet, grades, bankOrder]);

  // The Big Board's bank: every unplaced player, same order.
  const bigBank = useMemo(() => allPlayers.filter((p) => POSITIONS.includes(groupOf(p)) && !assignedSet.has(p.id)).sort(bankOrder === "alpha" ? alphaSort : bankSort(grades)),
    [allPlayers, assignedSet, grades, bankOrder]);

  // Each round's Big Board list. The saved order says which position holds
  // each slot; each position's slots are filled in that position's own
  // order in the round. Players the saved order doesn't know yet (placed
  // from a position view) go at the end, in position order.
  const bigLists = useMemo(() => {
    const out = {};
    if (!board) return out;
    ROUNDS.forEach((round) => {
      const members = new Set(POSITIONS.flatMap((pos) => board[round][pos]));
      const pattern = (bigOrder[round] || []).filter((id) => members.has(id)).map((id) => groupOf(playerById.get(id)));
      const seen = new Set((bigOrder[round] || []).filter((id) => members.has(id)));
      POSITIONS.forEach((pos) => board[round][pos].forEach((id) => { if (!seen.has(id)) pattern.push(pos); }));
      const next = {};
      out[round] = pattern.map((pos) => board[round][pos][(next[pos] = (next[pos] ?? -1) + 1)]).filter(Boolean);
    });
    return out;
  }, [board, bigOrder, playerById]);


  const totalByPos = useMemo(() => {
    const out = Object.fromEntries(POSITIONS.map((p) => [p, 0]));
    allPlayers.forEach((p) => { const g = groupOf(p); if (g in out) out[g] += 1; });
    return out;
  }, [allPlayers]);

  const placedByPos = useMemo(() => {
    if (!board) return {};
    return Object.fromEntries(POSITIONS.map((pos) => [pos, ROUNDS.reduce((n, r) => n + (board[r]?.[pos]?.length || 0), 0)]));
  }, [board]);

  const dayPositionCounts = useMemo(() => {
    if (!board) return [];
    return DAY_GROUPS.map(day => ({
      label: day.label,
      counts: POSITIONS.map(pos =>
        day.rounds.reduce((sum, round) => sum + (board[round]?.[pos]?.length || 0), 0)
      ),
    }));
  }, [board]);

  // The earlier save risers / fallers compare with: the history, plus the
  // board as it loaded when that was saved on an earlier day.
  const baseline = useMemo(() => {
    const h = { ...history };
    if (loadedSnap?.day && loadedSnap.order.length && !h[loadedSnap.day]) h[loadedSnap.day] = loadedSnap.order.join(",");
    return pickBaseline(h, statsDay());
  }, [history, loadedSnap]);

  const roundOf = useMemo(() => {
    const m = {};
    if (board) ROUNDS.forEach((r) => POSITIONS.forEach((p) => board[r][p].forEach((id) => { m[id] = r; })));
    return m;
  }, [board]);

  const boardStyles = `
    .wb-page { padding: 24px 16px 120px; background: ${SITE_BG}; min-height: calc(100vh / var(--pz, 1)); box-sizing: border-box; }
    .wb-page *, .wb-page *::before, .wb-page *::after { box-sizing: border-box; }
    @media (min-width: 900px) { .wb-page { padding: 36px 32px 120px; } }
    @media (max-width: 420px) { .wb-page { padding: 16px 10px 120px; } }
    .wb-inner { max-width: 1680px; margin: 0 auto; }

    /* ── Hero ── */
    .wb-hero {
      position: relative; overflow: hidden; border-radius: 20px; color: #fff;
      background: radial-gradient(120% 140% at 100% 0%, rgba(246,162,29,0.28) 0%, transparent 45%), linear-gradient(150deg, ${SITE_BLUE} 0%, ${SITE_NAVY} 70%, #04203f 100%);
      box-shadow: 0 14px 34px rgba(0,59,115,0.28); padding: 22px 20px 20px; margin-bottom: 16px;
    }
    @media (min-width: 900px) { .wb-hero { padding: 28px 32px; } }
    .wb-hero::after {
      content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0.07;
      background-image: linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px);
      background-size: 28px 28px;
    }
    .wb-hero-grid { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 18px 28px; align-items: flex-end; justify-content: space-between; }
    .wb-eyebrow { font-size: 11px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: ${SITE_GOLD}; margin-bottom: 6px; }
    .wb-title { font-size: 26px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.05; margin: 0; overflow-wrap: anywhere; }
    @media (min-width: 600px) { .wb-title { font-size: 34px; } }
    .wb-subtitle { font-size: 13px; color: rgba(255,255,255,0.75); margin-top: 8px; max-width: 520px; line-height: 1.45; }
    .wb-progress { margin-top: 16px; max-width: 420px; }
    .wb-progress-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.8); margin-bottom: 6px; }
    .wb-progress-top b { font-size: 20px; color: #fff; font-weight: 900; margin-right: 4px; }
    .wb-progress-bar { height: 8px; border-radius: 999px; background: rgba(255,255,255,0.16); overflow: hidden; }
    .wb-progress-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, ${SITE_GOLD}, #ffd27a); transition: width 0.3s ease; }

    .wb-hero-actions { display: flex; flex-direction: column; gap: 12px; align-items: stretch; min-width: 0; width: 420px; max-width: 100%; }
    @media (max-width: 760px) { .wb-hero-actions { width: 100%; } }
    .wb-seg { display: flex; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); border-radius: 999px; padding: 3px; }
    .wb-seg button {
      flex: 1; border: 0; background: transparent; color: rgba(255,255,255,0.9); font-weight: 900; font-size: 14px;
      padding: 11px 16px; border-radius: 999px; cursor: pointer; white-space: nowrap; font-family: inherit;
    }
    .wb-seg button.on { background: #fff; color: ${SITE_BLUE}; box-shadow: 0 2px 6px rgba(0,0,0,0.2); }
    .wb-hero-btns { display: flex; gap: 8px; }
    .wb-btn {
      flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 22px; min-height: 50px;
      border-radius: 999px; font-weight: 900; font-size: 15px; letter-spacing: 0.02em; cursor: pointer; border: 2px solid transparent;
      font-family: inherit; white-space: nowrap; transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.15s ease;
    }
    .wb-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,0.22); }
    .wb-btn:disabled { opacity: 0.55; cursor: default; }
    .wb-btn-save { background: ${SITE_GOLD}; color: ${SITE_INK}; }
    .wb-btn-save.dirty { background: ${FLAG_RED}; color: #fff; }
    .wb-btn-ghost { background: rgba(255,255,255,0.14); color: #fff; border-color: rgba(255,255,255,0.55); }
    .wb-btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.24); }
    .wb-btn-share { background: #fff; color: ${SITE_BLUE}; box-shadow: 0 6px 18px rgba(0,0,0,0.25); flex: 1.3; }
    .wb-btn-share:hover:not(:disabled) { background: #fff8e9; }
    .wb-btn-save { box-shadow: 0 6px 18px rgba(0,0,0,0.2); }
    .wb-locked {
      display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 7px 14px; border-radius: 999px;
      background: rgba(246,162,29,0.18); border: 1.5px solid rgba(246,162,29,0.55); color: #ffd68a; font-size: 13px; font-weight: 800;
    }
    .wb-share-cta {
      display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; border-radius: 999px; border: 0;
      background: ${SITE_BLUE}; color: #fff; font-family: inherit; font-weight: 900; font-size: 13px; cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,85,165,0.3);
    }
    .wb-share-cta:hover:not(:disabled) { filter: brightness(1.1); }
    .wb-share-cta:disabled { opacity: 0.4; cursor: default; box-shadow: none; }
    .wb-locked-handle { cursor: default !important; }
    .wb-icon-btn:disabled { cursor: default; }
    .wb-icon-btn:disabled:hover { background: transparent; }
    .wb-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .wb-dot.pulsing { animation: wb-pulse 1.4s ease-in-out infinite; }
    @keyframes wb-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

    /* ── Grades given ── */
    .wb-summary {
      background: #fff; border-radius: 16px; border: 1px solid ${SITE_BORDER}; box-shadow: 0 1px 3px rgba(11,18,32,0.06);
      padding: 14px 16px; margin-bottom: 16px;
    }
    .wb-summary > summary { list-style: none; cursor: pointer; display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .wb-summary > summary::-webkit-details-marker { display: none; }
    .wb-side-title { font-size: 11px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: ${SITE_INK}; }
    .wb-mini-sub { font-size: 11px; color: #9aa2b1; }
    .wb-summary-caret { font-size: 11px; font-weight: 800; color: ${SITE_BLUE}; }
    .wb-mini-scroll { overflow-x: auto; margin-top: 12px; }
    .wb-mini-grid { display: grid; grid-template-columns: 48px repeat(9, minmax(30px, 1fr)); gap: 4px; min-width: 330px; }
    .wb-mini-pos-label { text-align: center; font-size: 9px; font-weight: 900; color: #fff; padding: 4px 2px; border-radius: 5px; }
    .wb-mini-day-label { display: flex; align-items: center; font-size: 10px; font-weight: 800; color: ${SITE_INK}; }
    .wb-mini-cell { display: flex; align-items: center; justify-content: center; height: 26px; border-radius: 6px; font-size: 12px; font-weight: 800; background: ${SITE_BG}; color: ${SITE_INK}; }
    .wb-mini-cell.wb-mini-empty { color: #cfd4dc; font-weight: 500; }
    .wb-mini-unranked-label { color: #9aa2b1; }
    .wb-mini-unranked-cell { background: #fafbfc; color: #9aa2b1; outline: 1px dashed ${SITE_BORDER}; }

    /* ── Position tabs ── */
    .wb-tabs-wrap { position: sticky; top: 60px; z-index: 50; background: ${SITE_BG}; padding: 8px 0 10px; margin-bottom: 8px; transition: transform 0.2s ease; }
    .wb-tabs-wrap.wb-hidden { transform: translateY(-110%); }
    .wb-tabs { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px 2px 4px; -webkit-overflow-scrolling: touch; }
    .wb-tabs::-webkit-scrollbar { display: none; }
    .wb-tab {
      flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px;
      border: 1.5px solid ${SITE_BORDER}; background: #fff; color: ${SITE_INK}; font-weight: 800; font-size: 13px;
      cursor: pointer; font-family: inherit; transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .wb-tab-count { font-size: 11px; font-weight: 700; opacity: 0.6; }
    .wb-tab.on { color: #fff; border-color: transparent; box-shadow: 0 3px 10px rgba(11,18,32,0.18); }
    .wb-tab.on .wb-tab-count { opacity: 0.85; }

    /* ── Focus view (one position group) ── */
    .wb-focus-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 6px 0 14px; flex-wrap: wrap; }
    .wb-focus-title { display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 900; color: ${SITE_INK}; }
    .wb-focus-chip { color: #fff; border-radius: 8px; padding: 4px 10px; font-size: 15px; letter-spacing: 0.04em; }
    .wb-focus-sub { font-size: 12px; font-weight: 700; color: #8a93a3; }
    .wb-clear-pos {
      display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 999px; font-family: inherit;
      border: 1.5px solid #f1c6c6; background: #fff; color: ${FLAG_RED}; font-weight: 800; font-size: 12px; cursor: pointer;
    }
    .wb-clear-pos:hover:not(:disabled) { background: #fdecec; }
    .wb-clear-pos:disabled { opacity: 0.4; cursor: default; }
    .wb-round {
      background: #fff; border: 1px solid ${SITE_BORDER}; border-radius: 14px; margin-bottom: 10px; overflow: hidden;
      box-shadow: 0 1px 2px rgba(11,18,32,0.04);
    }
    .wb-round-head { display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; background: ${SITE_INK}; color: #fff; }
    .wb-round-name { font-size: 12px; font-weight: 900; letter-spacing: 0.12em; }
    .wb-round-count { font-size: 11px; font-weight: 800; color: ${SITE_GOLD}; }
    .wb-drop {
      min-height: 64px; padding: 10px; display: grid; gap: 8px; grid-template-columns: repeat(5, minmax(0, 1fr));
      transition: background 0.15s ease, box-shadow 0.15s ease;
    }
    @media (max-width: 1379px) { .wb-drop { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    @media (max-width: 1129px) { .wb-drop { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 899px) { .wb-drop { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 599px) { .wb-drop { grid-template-columns: 1fr; padding: 8px; gap: 6px; } }
    .wb-drop.wb-over { background: #fff8e9; box-shadow: inset 0 0 0 2px ${SITE_GOLD}; }
    .wb-drop-empty { grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; min-height: 44px; border: 1.5px dashed ${SITE_BORDER}; border-radius: 10px; color: #b3bac6; font-size: 12px; font-weight: 700; text-align: center; padding: 6px; }

    /* ── All view (the grid) ── */
    .wb-pos-header-wrap { position: sticky; top: 60px; z-index: 50; background: ${SITE_BG}; transition: transform 0.2s ease; }
    .wb-pos-header-wrap.wb-hidden { transform: translateY(-110%); }
    .wb-pos-header-scroll { overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
    .wb-pos-header-scroll::-webkit-scrollbar { display: none; }
    .wb-grid-row { display: grid; grid-template-columns: 76px repeat(9, minmax(150px, 1fr)); gap: 10px; min-width: 1500px; }
    .wb-pos-header { padding: 10px 0 12px; margin-bottom: 14px; border-bottom: 3px solid ${SITE_GOLD}; }
    .wb-pos-label {
      position: relative; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 900; font-size: 14px;
      letter-spacing: 0.04em; color: #fff; padding: 8px 30px; border-radius: 10px;
    }
    .wb-pos-label small { font-size: 11px; font-weight: 700; opacity: 0.8; }
    .wb-pos-x {
      position: absolute; right: 5px; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; border-radius: 50%;
      border: 0; background: rgba(0,0,0,0.22); color: #fff; font-size: 13px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center;
    }
    .wb-pos-x:hover { background: rgba(0,0,0,0.4); }
    .wb-board-scroll { overflow-x: auto; overflow-y: hidden; padding-bottom: 8px; }
    .wb-round-row { margin-bottom: 14px; }
    .wb-round-label {
      display: flex; align-items: center; justify-content: center; background: ${SITE_INK}; color: #fff; border-radius: 10px;
      font-weight: 900; font-size: 12px; letter-spacing: 0.1em; text-align: center; padding: 10px 4px;
      writing-mode: vertical-rl; transform: rotate(180deg);
    }
    .wb-col {
      min-height: 150px; background: #fff; border: 1.5px dashed ${SITE_BORDER}; border-radius: 12px; padding: 8px;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .wb-col.wb-over { border-color: ${SITE_GOLD}; border-style: solid; background: #fff8e9; }

    /* ── Bank ── */
    .wb-bank-wrap { margin-top: 36px; scroll-margin-top: 130px; }
    .wb-bank-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px 16px; margin-bottom: 12px; flex-wrap: wrap; }
    .wb-bank-title { font-size: 20px; font-weight: 900; color: ${SITE_INK}; letter-spacing: -0.01em; }
    .wb-bank-sub { font-size: 12px; color: #8a93a3; font-weight: 600; }
    .wb-bank-box { background: #fff; border: 1.5px dashed #d5dbe4; border-radius: 14px; }
    .wb-jump { display: inline-flex; padding: 7px 16px; background: #fff; color: ${SITE_BLUE}; border: 1.5px solid ${SITE_BLUE}; border-radius: 999px; font-weight: 800; font-size: 12px; cursor: pointer; font-family: inherit; }
    .wb-jump:hover { background: #eef4fb; }

    /* ── Player chip ── */
    .wb-player-card {
      display: flex; align-items: stretch; border: 1.5px solid ${SITE_BORDER}; border-radius: 12px; background: #fff;
      overflow: hidden; box-shadow: 0 1px 2px rgba(11,18,32,0.05); transition: box-shadow 0.12s ease, transform 0.12s ease; min-width: 0;
    }
    .wb-col .wb-player-card { margin-bottom: 6px; border-radius: 10px; }
    .wb-player-card:hover { box-shadow: 0 6px 16px rgba(11,18,32,0.10); }
    .wb-player-handle {
      flex-shrink: 0; width: 34px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
      cursor: grab; touch-action: none; transition: filter 0.12s ease; color: #fff;
    }
    .wb-compact .wb-player-handle { width: 26px; }
    @media (max-width: 760px) { .wb-player-handle { width: 36px; } }
    .wb-player-handle:hover { filter: brightness(1.1); }
    .wb-player-handle:focus-visible { outline: 3px solid ${SITE_GOLD}; outline-offset: -3px; }
    .wb-player-handle:active { cursor: grabbing; }
    .wb-handle-pos { font-size: 9px; font-weight: 900; letter-spacing: 0.04em; line-height: 1; }
    .wb-compact .wb-handle-pos { font-size: 8px; }
    .wb-player-handle-icon { color: rgba(255,255,255,0.75); font-size: 14px; line-height: 1; }
    .wb-handle-rank { font-size: 11px; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
    .wb-chip-logo { flex-shrink: 0; width: 26px; height: 26px; object-fit: contain; }
    .wb-chip-logo-blank { flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; background: ${SITE_BG}; }
    .wb-drop .wb-player-body { gap: 7px; padding: 7px 4px 7px 8px; }
    .wb-drop .wb-grade { width: 34px; height: 32px; }
    .wb-player-body { flex: 1; min-width: 0; padding: 8px 8px 8px 10px; display: flex; align-items: center; gap: 8px; }
    .wb-compact .wb-player-body { padding: 6px 4px 6px 8px; gap: 4px; }
    .wb-player-name-col { min-width: 0; flex: 1; }
    .wb-player-link { text-decoration: none; color: ${SITE_INK}; display: flex; flex-direction: column; line-height: 1.12; }
    .wb-player-link:hover .wb-player-last { color: ${SITE_BLUE}; }
    .wb-player-first { font-weight: 600; color: #6b7587; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wb-player-last { font-weight: 900; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em; }
    .wb-compact .wb-player-last { font-size: 13px; }
    .wb-player-sub { display: flex; align-items: center; gap: 5px; margin-top: 3px; min-width: 0; }
    .wb-player-school { font-size: 11px; color: #8a93a3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }

    .wb-grade {
      flex-shrink: 0; width: 38px; height: 34px; border-radius: 8px; border: 1.5px solid transparent; color: #fff;
      display: inline-flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1;
    }
    .wb-grade b { font-size: 13px; font-weight: 900; letter-spacing: -0.02em; }
    .wb-grade small { font-size: 6.5px; font-weight: 900; letter-spacing: 0.06em; opacity: 0.9; margin-bottom: 2px; }
    .wb-grade-sm { width: auto; height: 17px; padding: 0 5px; border-radius: 5px; border-width: 1px; }
    .wb-grade-sm b { font-size: 10px; }
    .wb-grade-none { background: transparent; border: 1.5px dashed ${SITE_BORDER}; color: #c3c9d3; font-size: 13px; font-weight: 800; }

    .wb-player-actions { display: flex; flex-direction: column; align-items: center; gap: 0; flex-shrink: 0; }
    .wb-icon-btn {
      display: flex; align-items: center; justify-content: center; width: 24px; height: 22px; padding: 0; border: none; border-radius: 6px;
      background: transparent; cursor: pointer; font-size: 14px; line-height: 1; color: #c9cdd6; transition: transform 0.1s ease, color 0.12s ease, background 0.12s ease;
    }
    .wb-compact .wb-icon-btn { width: 20px; height: 20px; font-size: 13px; }
    @media (max-width: 760px) { .wb-drop .wb-icon-btn { width: 30px; height: 26px; font-size: 15px; } }
    .wb-icon-btn:hover { background: ${SITE_BG}; }
    .wb-icon-btn.wb-star-active { color: ${SITE_GOLD}; }
    .wb-icon-btn.wb-flag-active { color: ${FLAG_RED}; }
    /* ── Round menu (a tap on a chip's handle) ── */
    .wb-menu-back { position: fixed; inset: 0; z-index: 10040; background: transparent; }
    .wb-round-menu {
      position: fixed; z-index: 10041; width: 168px; background: #fff; border: 1px solid ${SITE_BORDER}; border-radius: 14px;
      box-shadow: 0 18px 40px rgba(11,18,32,0.22); padding: 6px; display: flex; flex-direction: column;
    }
    .wb-round-menu-h { font-size: 10px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: #8a93a3; padding: 6px 10px 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wb-round-menu button {
      display: flex; align-items: center; justify-content: space-between; border: 0; background: transparent; text-align: left;
      padding: 0 10px; height: 38px; border-radius: 9px; font-family: inherit; font-weight: 800; font-size: 14px; color: ${SITE_INK}; cursor: pointer;
    }
    .wb-round-menu button:hover { background: ${SITE_BG}; }
    .wb-round-menu button.on { background: ${SITE_INK}; color: #fff; }
    .wb-round-menu button span { color: ${SITE_GOLD}; }
    .wb-round-menu .wb-round-menu-bank { margin-top: 4px; border-top: 1px solid ${SITE_BORDER}; border-radius: 0 0 9px 9px; color: #6b7587; }

    /* ── Bank tools ── */
    .wb-bank-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .wb-mini-seg { display: inline-flex; background: #fff; border: 1.5px solid ${SITE_BORDER}; border-radius: 999px; padding: 2px; }
    .wb-mini-seg button { border: 0; background: transparent; border-radius: 999px; padding: 5px 12px; font-family: inherit; font-weight: 800; font-size: 12px; color: #6b7587; cursor: pointer; }
    .wb-mini-seg button.on { background: ${SITE_INK}; color: #fff; }
    .wb-add-graded {
      border: 1.5px solid ${SITE_BLUE}; background: ${SITE_BLUE}; color: #fff; border-radius: 999px; padding: 6px 14px;
      font-family: inherit; font-weight: 900; font-size: 12px; cursor: pointer;
    }
    .wb-add-graded:hover:not(:disabled) { filter: brightness(1.08); }
    .wb-add-graded:disabled { opacity: 0.4; cursor: default; }

    /* ── Sticky bars ── */
    .wb-bottom-bar {
      position: fixed; left: 50%; bottom: max(16px, env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 900;
      display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 16px; border-radius: 999px; background: ${SITE_INK}; color: #fff;
      box-shadow: 0 10px 30px rgba(11,18,32,0.35); max-width: calc(100vw - 24px); font-size: 13px; font-weight: 700;
    }
    .wb-bottom-bar .wb-btn { flex: 0 0 auto; padding: 8px 16px; font-size: 13px; }
    .wb-bottom-msg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }

    .wb-state-page { padding: 100px 24px; text-align: center; }
    .wb-state-card { max-width: 420px; margin: 0 auto; background: #fff; border-radius: 16px; border: 1px solid ${SITE_BORDER}; padding: 36px 28px; box-shadow: 0 1px 3px rgba(11,18,32,0.06); }
  `;

  // Still resolving auth — show nothing yet
  if (!authReady) return null;

  if (!user) {
    return (
      <div className="wb-state-page" style={{ background: SITE_BG, minHeight: "calc(100vh / var(--pz, 1))" }}>
        <style>{boardStyles}</style>
        <div className="wb-state-card">
          <h2 style={{ color: SITE_INK, fontSize: 20, margin: 0 }}>Please log in to access your draft board.</h2>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="wb-state-page" style={{ background: SITE_BG, minHeight: "calc(100vh / var(--pz, 1))" }}>
        <style>{boardStyles}</style>
        <div className="wb-state-card">
          <h2 style={{ color: SITE_INK, fontSize: 18, margin: 0 }}>{loadError}</h2>
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div style={{ background: SITE_BG, minHeight: "calc(100vh / var(--pz, 1))" }}>
        <style>{boardStyles}</style>
        <LoadingSpinner label="Loading your whiteboard" size={48} minHeight="calc(100vh / var(--pz, 1))" />
      </div>
    );
  }

  const pct = allPlayers.length ? Math.round((assignedIds.length / allPlayers.length) * 100) : 0;
  const hasAnything = assignedIds.length > 0 || Object.keys(markers).length > 0;
  // Big Board only: each placed player's overall rank, shown in his handle.
  const bigRank = {};
  if (focus === "BIG") { let n = 0; ROUNDS.forEach((r) => (bigLists[r] || []).forEach((id) => { bigRank[id] = ++n; })); }
  const cardProps = { markers, onToggleMarker: toggleMarker, grades, shortOf, logoOf, rankOf: bigRank, onOpenMenu: openRoundMenu, locked };
  const bankTools = (players, label) => (
    <div className="wb-bank-tools">
      <div className="wb-mini-seg" role="group" aria-label="Bank order">
        <button className={bankOrder === "grade" ? "on" : ""} onClick={() => setBankOrder("grade")}>My grade</button>
        <button className={bankOrder === "alpha" ? "on" : ""} onClick={() => setBankOrder("alpha")}>A–Z</button>
      </div>
      {!locked && <button className="wb-add-graded" onClick={() => addGraded(players, label)} disabled={!players.some((pl) => ROUND_FOR_GRADE[grades[pl.id]])}
        title="Place every graded player here in the round you graded him">
        + Add graded
      </button>}
    </div>
  );
  const orderNote = bankOrder === "alpha" ? "A–Z" : "by your grade, then A–Z";
  const tabs = isMobile ? [...POSITIONS, "BIG"] : ["ALL", ...POSITIONS, "BIG"];
  const TAB_LABEL = { ALL: "Whiteboard", BIG: "Big Board" };

  return (
    <div className="wb-page">
      <style>{boardStyles}</style>
      <div className="wb-inner">

        {/* HERO */}
        <div className="wb-hero">
          <div className="wb-hero-grid">
            <div style={{ minWidth: 0, flex: "1 1 320px" }}>
              <div className="wb-eyebrow">Whiteboard · {selectedClass === "2026" ? "2026 Archive" : `${selectedClass} Class`}</div>
              <h1 className="wb-title">{username ? `${username}'s Board` : "My Board"}</h1>
              {locked && <div className="wb-locked">🔒 Locked · the {selectedClass} draft is done. This board is view-only.</div>}
              <div className="wb-subtitle">
                {locked ? "Look back at how you had it — you can still share graphics of it." : isMobile
                  ? "Drag a player by his colored handle, or tap the handle to pick his round."
                  : "Drag players by their colored handle into a round, or click the handle to pick a round."}
              </div>
              <div className="wb-progress">
                <div className="wb-progress-top">
                  <span><b>{assignedIds.length}</b>of {allPlayers.length} placed</span>
                  <span>{pct}%</span>
                </div>
                <div className="wb-progress-bar"><div className="wb-progress-fill" style={{ width: `${pct}%` }} /></div>
              </div>
            </div>

            <div className="wb-hero-actions">
              <div className="wb-seg" role="tablist" aria-label="Draft class">
                {DRAFT_CLASSES.map((year) => (
                  <button key={year} role="tab" aria-selected={year === selectedClass} className={year === selectedClass ? "on" : ""} onClick={() => changeClass(year)}>
                    {year === "2026" ? "2026 Archive" : year}
                  </button>
                ))}
              </div>
              <div className="wb-hero-btns">
                <button className="wb-btn wb-btn-share" onClick={() => setSharePos(POSITIONS.includes(focus) ? focus : "ALL")} disabled={!assignedIds.length} title="Share a graphic of your board">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" /></svg>
                  Share
                </button>
                {!locked && (
                  <button className={`wb-btn wb-btn-save${isDirty ? " dirty" : ""}`} onClick={handleSave} disabled={saving || !isDirty}>
                    <span className={`wb-dot${isDirty ? " pulsing" : ""}`} />
                    {saving ? "Saving…" : isDirty ? "Save" : "Saved"}
                  </button>
                )}
                {!locked && (
                  <button className="wb-btn wb-btn-ghost" onClick={clearAll} disabled={!hasAnything} title="Send every player back to the Player Bank">
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* GRADES GIVEN — by draft day and position */}
        <details className="wb-summary" open={!isMobile}>
          <summary>
            <span className="wb-side-title">Grades Given</span>
            <span className="wb-mini-sub">{isMobile ? <span className="wb-summary-caret">Show ▾</span> : "Players placed, by draft day and position"}</span>
          </summary>
          <div className="wb-mini-scroll">
            <div className="wb-mini-grid">
              <div></div>
              {POSITIONS.map(pos => (
                <div key={pos} className="wb-mini-pos-label" style={{ background: POS_COLORS[pos] }}>{pos}</div>
              ))}
              {dayPositionCounts.map(day => (
                <React.Fragment key={day.label}>
                  <div className="wb-mini-day-label">{day.label}</div>
                  {day.counts.map((count, i) => (
                    <div key={POSITIONS[i]} className={`wb-mini-cell${count === 0 ? " wb-mini-empty" : ""}`}>{count === 0 ? "–" : count}</div>
                  ))}
                </React.Fragment>
              ))}
              <div className="wb-mini-day-label wb-mini-unranked-label">Bank</div>
              {POSITIONS.map((pos) => {
                const count = bankByPos[pos].length;
                return <div key={`bank-${pos}`} className={`wb-mini-cell wb-mini-unranked-cell${count === 0 ? " wb-mini-empty" : ""}`}>{count === 0 ? "–" : count}</div>;
              })}
            </div>
          </div>
        </details>

        {/* POSITION TABS */}
        <div className="wb-tabs-wrap" style={focus === "ALL" ? { position: "static" } : undefined}>
          <div className="wb-tabs" role="tablist" aria-label="Position group">
            {tabs.map((t) => {
              const on = t === focus;
              const bg = TAB_LABEL[t] ? (t === "BIG" ? SITE_BLUE : SITE_INK) : POS_COLORS[t];
              return (
                <button key={t} role="tab" aria-selected={on} className={`wb-tab${on ? " on" : ""}`} style={on ? { background: bg } : { borderColor: TAB_LABEL[t] ? SITE_BORDER : `${bg}55` }} onClick={() => setView(t)}>
                  {TAB_LABEL[t] || t}
                  {!TAB_LABEL[t] && <span className="wb-tab-count">{placedByPos[t]}/{totalByPos[t]}</span>}
                  {t === "BIG" && <span className="wb-tab-count">{assignedIds.length}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <DndContext sensors={locked ? undefined : sensors} collisionDetection={collision} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
          {/* dnd-kit positions the overlay with fixed px measured in screen px,
              so cancel the page zoom on the overlay box and restore it inside. */}
          <DragOverlay style={{ zoom: 1 / getPageScale() }}>
            {activeId ? (() => {
              const player = playerById.get(activeId);
              if (!player) return null;
              return (
                <div style={{ zoom: getPageScale(), display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: `2px solid ${SITE_GOLD}`, background: "#fff", fontSize: 13, fontWeight: 800, boxShadow: "0 10px 24px rgba(11,18,32,0.28)", borderRadius: 10, cursor: "grabbing", color: SITE_INK }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: POS_COLORS[groupOf(player)] || SITE_GOLD }} />
                  {`${(player.First || "").charAt(0)}. ${player.Last || ""}`}
                </div>
              );
            })() : null}
          </DragOverlay>

          {focus === "ALL" ? (
            <>
              {/* STICKY POSITION HEADER */}
              {/* Sticks under the navbar the whole way down the grid. */}
              <div className="wb-pos-header-wrap">
                <div className="wb-pos-header-scroll" ref={headerScrollRef} onScroll={syncHeaderScroll}>
                  <div className="wb-grid-row wb-pos-header">
                    <div></div>
                    {POSITIONS.map(pos => (
                      <div key={pos} className="wb-pos-label" style={{ background: POS_COLORS[pos] }}>
                        <button type="button" onClick={() => setView(pos)} style={{ all: "unset", cursor: "pointer" }} title={`Open the ${pos} group`}>{pos}</button>
                        <small>{placedByPos[pos]}/{totalByPos[pos]}</small>
                        {placedByPos[pos] > 0 && !locked && (
                          <button type="button" className="wb-pos-x" onClick={() => clearPosition(pos)} aria-label={`Clear ${pos}`} title={`Clear ${pos}`}>✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="wb-board-scroll" ref={boardScrollRef} onScroll={syncBodyScroll}>
                {ROUNDS.map((round) => (
                  <div key={round} className="wb-grid-row wb-round-row">
                    <div className="wb-round-label">{round}</div>
                    {POSITIONS.map(pos => (
                      <GridColumn key={`${round}-${pos}`} id={`${round}::${pos}`} ids={board[round][pos]} playerById={playerById} cardProps={cardProps} />
                    ))}
                  </div>
                ))}
              </div>

              <div ref={playerBankRef} className="wb-bank-wrap">
                <div className="wb-bank-head">
                  <div>
                    <div className="wb-bank-title">Player Bank</div>
                    <div className="wb-bank-sub">Unplaced players, by position · {orderNote}</div>
                  </div>
                  {bankTools(POSITIONS.flatMap((pos) => bankByPos[pos]), "the bank")}
                </div>
                <div className="wb-board-scroll">
                  <div className="wb-grid-row">
                    <div></div>
                    {POSITIONS.map(pos => (
                      <GridColumn key={pos} id={`bank::${pos}`} ids={bankByPos[pos].map((p) => p.id)} playerById={playerById} cardProps={cardProps} />
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : focus === "BIG" ? (
            <>
              <div className="wb-focus-head">
                <div>
                  <div className="wb-focus-title">
                    <span className="wb-focus-chip" style={{ background: SITE_BLUE }}>ALL</span>
                    <span>Big Board</span>
                  </div>
                  <div className="wb-focus-sub" style={{ marginTop: 4 }}>Rank every position together, round by round · {assignedIds.length} of {allPlayers.length} placed</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="wb-jump" onClick={scrollToPlayers}>Player bank ↓</button>
                  <button className="wb-share-cta" onClick={() => setSharePos("ALL")} disabled={!assignedIds.length}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" /></svg>
                    Share Big Board
                  </button>
                </div>
              </div>

              {ROUNDS.map((round) => {
                const ids = bigLists[round] || [];
                return (
                  <div key={round} className="wb-round">
                    <div className="wb-round-head">
                      <span className="wb-round-name">{round === "UDFA" ? "UNDRAFTED FREE AGENT" : round}</span>
                      <span className="wb-round-count">{ids.length || ""}</span>
                    </div>
                    <FocusDrop id={`big::${round}`} ids={ids} playerById={playerById} cardProps={cardProps}
                      empty={isMobile ? "Drag any player here, or tap his handle to pick a round" : "Drop any position here, then drag to rank"} />
                  </div>
                );
              })}

              <div ref={playerBankRef} className="wb-bank-wrap">
                <div className="wb-bank-head">
                  <div>
                    <div className="wb-bank-title">Player Bank</div>
                    <div className="wb-bank-sub">{bigBank.length} unplaced · {orderNote}</div>
                  </div>
                  {bankTools(bigBankPos === "ALL" ? bigBank : bankByPos[bigBankPos], bigBankPos === "ALL" ? "the bank" : `the ${bigBankPos} bank`)}
                </div>
                <div className="wb-tabs" style={{ marginBottom: 10 }} role="tablist" aria-label="Bank position">
                  {["ALL", ...POSITIONS].map((p) => {
                    const on = bigBankPos === p;
                    const n = p === "ALL" ? bigBank.length : bankByPos[p].length;
                    return (
                      <button key={p} role="tab" aria-selected={on} className={`wb-tab${on ? " on" : ""}`}
                        style={on ? { background: p === "ALL" ? SITE_INK : POS_COLORS[p] } : undefined} onClick={() => setBigBankPos(p)}>
                        {p === "ALL" ? "All" : p}<span className="wb-tab-count">{n}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="wb-bank-box">
                  <FocusDrop id="bank::ALL" ids={(bigBankPos === "ALL" ? bigBank : bankByPos[bigBankPos]).map((p) => p.id)} playerById={playerById} cardProps={cardProps}
                    empty="Everyone here is on your board." />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="wb-focus-head">
                <div>
                  <div className="wb-focus-title">
                    <span className="wb-focus-chip" style={{ background: POS_COLORS[focus] }}>{focus}</span>
                    <span>Board</span>
                  </div>
                  <div className="wb-focus-sub" style={{ marginTop: 4 }}>{placedByPos[focus]} of {totalByPos[focus]} placed · {bankByPos[focus].length} in the bank</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="wb-jump" onClick={scrollToPlayers}>Player bank ↓</button>
                  <button className="wb-share-cta" onClick={() => setSharePos(focus)} disabled={!placedByPos[focus]}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" /></svg>
                    Share {focus}
                  </button>
                  {!locked && <button className="wb-clear-pos" onClick={() => clearPosition(focus)} disabled={!placedByPos[focus] && !allPlayers.some((p) => groupOf(p) === focus && markers[p.id])}>
                    ✕ Clear {focus}
                  </button>}
                </div>
              </div>

              {ROUNDS.map((round) => {
                const ids = board[round][focus];
                return (
                  <div key={round} className="wb-round">
                    <div className="wb-round-head">
                      <span className="wb-round-name">{round === "UDFA" ? "UNDRAFTED FREE AGENT" : round}</span>
                      <span className="wb-round-count">{ids.length || ""}</span>
                    </div>
                    <FocusDrop id={`${round}::${focus}`} ids={ids} playerById={playerById} cardProps={cardProps}
                      empty={isMobile ? "Drag a player here, or tap his handle to pick a round" : "Drop players here"} />
                  </div>
                );
              })}

              <div ref={playerBankRef} className="wb-bank-wrap">
                <div className="wb-bank-head">
                  <div>
                    <div className="wb-bank-title">{focus} Player Bank</div>
                    <div className="wb-bank-sub">{bankByPos[focus].length} unplaced · {orderNote}</div>
                  </div>
                  {bankTools(bankByPos[focus], `the ${focus} bank`)}
                </div>
                <div className="wb-bank-box">
                  <FocusDrop id={`bank::${focus}`} ids={bankByPos[focus].map((p) => p.id)} playerById={playerById} cardProps={cardProps}
                    empty={`Every ${focus} is on your board.`} />
                </div>
              </div>
            </>
          )}
        </DndContext>
      </div>

      {sharePos && (
        <ShareGraphicDialog
          pos={sharePos}
          onPos={setSharePos}
          onClose={() => { setSharePos(null); setSharePrompted(false); }}
          prompted={sharePrompted}
          board={board}
          markers={markers}
          playerById={playerById}
          placedByPos={placedByPos}
          bigLists={bigLists}
          shortOf={shortOf}
          classYear={selectedClass}
          owner={username}
          uid={user?.uid}
          baseline={baseline}
        />
      )}

      {roundMenu && (() => {
        const pl = playerById.get(roundMenu.id);
        const current = roundOf[roundMenu.id] || "";
        const pick = (r) => { setRoundMenu(null); if (r !== current) moveTo(roundMenu.id, r); };
        return (
          <>
            <div className="wb-menu-back" onClick={() => setRoundMenu(null)} />
            <div className="wb-round-menu" role="menu" style={{ left: roundMenu.left, top: roundMenu.top }}>
              <div className="wb-round-menu-h">{pl ? `${(pl.First || "").charAt(0)}. ${pl.Last || ""}` : ""}</div>
              {ROUNDS.map((r) => (
                <button key={r} role="menuitemradio" aria-checked={r === current} className={r === current ? "on" : ""} onClick={() => pick(r)}>
                  {r === "UDFA" ? "UDFA" : r.replace("ROUND", "Round")}{r === current && <span>✓</span>}
                </button>
              ))}
              <button role="menuitemradio" aria-checked={!current} className={`wb-round-menu-bank${!current ? " on" : ""}`} onClick={() => pick("")}>
                Bank{!current && <span>✓</span>}
              </button>
            </div>
          </>
        );
      })()}

      {/* UNDO / SAVE BAR */}
      {undo ? (
        <div className="wb-bottom-bar" role="status">
          <span className="wb-bottom-msg">{undo.label} — not saved yet</span>
          <button className="wb-btn wb-btn-save" onClick={undoClear}>Undo</button>
        </div>
      ) : isDirty ? (
        <div className="wb-bottom-bar" role="status">
          <span className="wb-bottom-msg">Unsaved changes</span>
          <button className="wb-btn wb-btn-save dirty" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      ) : null}
    </div>
  );
}

function GridColumn({ id, ids, playerById, cardProps }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`wb-col${isOver ? " wb-over" : ""}`}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ids.map((pid) => {
          const player = playerById.get(pid);
          return player ? <DraggablePlayer key={pid} id={pid} player={player} compact {...cardProps} /> : null;
        })}
      </SortableContext>
    </div>
  );
}

function FocusDrop({ id, ids, playerById, cardProps, empty }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`wb-drop${isOver ? " wb-over" : ""}`}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        {ids.map((pid) => {
          const player = playerById.get(pid);
          return player ? <DraggablePlayer key={pid} id={pid} player={player} {...cardProps} /> : null;
        })}
      </SortableContext>
      {ids.length === 0 && <div className="wb-drop-empty">{empty}</div>}
    </div>
  );
}

// The user's grade on a chip: the site's badge colors (utils/gradeScale.js),
// the short round with EARLY / MIDDLE / LATE over a 1st. Full label on hover.
function GradeBadge({ grade, compact }) {
  if (!grade) {
    return compact ? null : <span className="wb-grade wb-grade-none" title="Not graded yet">—</span>;
  }
  const look = gradeLook(grade);
  return (
    <span className={`wb-grade${compact ? " wb-grade-sm" : ""}`} title={`Your grade: ${grade}`} style={{ background: look.bg, borderColor: look.border }}>
      {!compact && look.qualifier && <small>{look.qualifier}</small>}
      <b>{look.short}</b>
    </span>
  );
}

// A school name that falls back to its short name when the full one won't
// fit (and back again when there's room). Full name on hover either way.
function SchoolName({ full, short }) {
  const ref = useRef(null);
  const [useShort, setUseShort] = useState(false);
  useLayoutEffect(() => { setUseShort(false); }, [full, short]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || useShort || !short) return;
    if (el.scrollWidth > el.clientWidth + 1) setUseShort(true);
  }, [useShort, short, full]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !short || typeof ResizeObserver === "undefined") return undefined;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth > w + 2) setUseShort(false); w = el.clientWidth; });
    ro.observe(el);
    return () => ro.disconnect();
  }, [short]);
  return <span ref={ref} className="wb-player-school" title={full}>{useShort ? short : full}</span>;
}

// A player chip. The colored handle (labelled with his position — and on
// the Big Board his overall rank under the grip) drags; a tap or click on
// it opens the round menu instead (the PointerSensor only starts a drag
// after a few px of movement). Wide chips (Big Board, position boards):
// the user's grade and the school logo, then name and school, then star /
// flag. `compact` is the Whiteboard grid's narrow column: no logo, and the
// grade sits beside the school.
function DraggablePlayer({ id, player, markers, onToggleMarker, grades, shortOf, logoOf, rankOf, onOpenMenu, locked = false, compact = false }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data: { playerId: id }, disabled: locked });
  const marker = markers[id];
  const starred = !!marker?.starred;
  const flagged = !!marker?.flagged;
  const pos = groupOf(player);
  const accent = POS_COLORS[pos] || SITE_GOLD;
  const grade = grades[id];
  const rank = rankOf?.[id];
  const logo = logoOf?.[player.School];
  const name = `${player.First || ""} ${player.Last || ""}`.trim();

  const ringColor = flagged ? FLAG_RED : starred ? SITE_GOLD : SITE_BORDER;
  const style = {
    transform: CSS.Transform.toString(unzoomTransform(transform)),
    transition,
    opacity: isDragging ? 0.4 : 1,
    borderColor: ringColor,
    boxShadow: flagged ? "0 0 0 2px rgba(211,47,47,0.18)" : starred ? "0 0 0 2px rgba(246,162,29,0.28)" : undefined,
  };

  return (
    <div ref={setNodeRef} className={`wb-player-card${compact ? " wb-compact" : ""}`} style={style}>
      <div
        className={`wb-player-handle${locked ? " wb-locked-handle" : ""}`} style={{ background: accent }} {...(locked ? {} : attributes)} {...(locked ? {} : listeners)}
        onClick={(e) => { if (!locked) onOpenMenu(id, e.currentTarget); }}
        onKeyDown={(e) => { if (locked) return; if (e.key === "Enter") { e.preventDefault(); onOpenMenu(id, e.currentTarget); } else listeners?.onKeyDown?.(e); }}
        aria-haspopup={locked ? undefined : "menu"} aria-label={`${rank ? `#${rank} ` : ""}${name}: drag, or tap to pick a round`} title="Drag, or click to pick a round"
      >
        <span className="wb-handle-pos">{pos}</span>
        <span className="wb-player-handle-icon" aria-hidden="true">⠿</span>
        {rank != null && <span className="wb-handle-rank">{rank}</span>}
      </div>
      <div className="wb-player-body">
        {!compact && <GradeBadge grade={grade} />}
        {!compact && (logo
          ? <img className="wb-chip-logo" src={logo.startsWith("http") ? logo : `https://${logo}`} alt="" title={player.School || ""} loading="lazy" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
          : <span className="wb-chip-logo-blank" aria-hidden="true" />)}
        <div className="wb-player-name-col">
          <a href={`/player/${player.Slug || player.slug}`} target="_blank" rel="noopener noreferrer" className="wb-player-link">
            <span className="wb-player-first">{player.First || ""}</span>
            <span className="wb-player-last">{player.Last || ""}</span>
          </a>
          <div className="wb-player-sub">
            {compact && <GradeBadge grade={grade} compact />}
            <SchoolName full={player.School || ""} short={shortOf[player.School] || ""} />
          </div>
        </div>
        <div className="wb-player-actions">
          <button type="button" disabled={locked} className={`wb-icon-btn${starred ? " wb-star-active" : ""}`} onClick={() => onToggleMarker(id, "starred")} aria-label={starred ? "Unstar player" : "Star player"} title={starred ? "Unstar" : "Star"}>★</button>
          <button type="button" disabled={locked} className={`wb-icon-btn${flagged ? " wb-flag-active" : ""}`} onClick={() => onToggleMarker(id, "flagged")} aria-label={flagged ? "Remove red flag" : "Red flag player"} title={flagged ? "Remove flag" : "Flag"}>⚑</button>
        </div>
      </div>
    </div>
  );
}

// A dropdown in the share dialog (List, Position): label, options
// [{ id, label, disabled }], and an optional colored dot for the choice.
function WbSelect({ id, label, value, onChange, options, dot }) {
  return (
    <div className="wdss-opt">
      <label className="wdss-label" htmlFor={id}>{label}</label>
      <div style={{ position: "relative" }}>
        {dot && <span aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", width: 10, height: 10, marginTop: -5, borderRadius: "50%", background: dot }} />}
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", appearance: "none", WebkitAppearance: "none", border: "1px solid var(--line)", background: "var(--soft)", color: "var(--fg)", borderRadius: 10, padding: `9px 34px 9px ${dot ? 30 : 12}px`, font: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          {options.map((o) => <option key={o.id} value={o.id} disabled={o.disabled}>{o.label}</option>)}
        </select>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", right: 12, top: "50%", marginTop: -6, pointerEvents: "none", color: "var(--mut)" }}><path d="M6 9l6 6 6-6" /></svg>
      </div>
    </div>
  );
}

// A themed list's players: the picks in order (tap one to take it off),
// then a search of the board — matches show as you type; tap one to add
// it, up to max.
function ListPicker({ accent, players, chosen, max, search, onSearch, onToggle, onClear }) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const q = search.trim().toLowerCase();
  const full = chosen.length >= max;
  const results = q ? players.filter((p) => !chosen.includes(p.id) && `${p.First} ${p.Last} ${p.School}`.toLowerCase().includes(q)).slice(0, 8) : [];
  const link = { background: "none", border: "none", padding: 0, font: "inherit", fontSize: 12, fontWeight: 800, color: "var(--mut)", cursor: "pointer", textDecoration: "underline" };
  const add = (id) => { onToggle(id); onSearch(""); };
  return (
    <div className="wdss-opt">
      <div className="wdss-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span>Players · {chosen.length}/{max}</span>
        <span style={{ display: "flex", gap: 12, textTransform: "none", letterSpacing: 0 }}>
          {chosen.length > 0 && <button type="button" style={link} onClick={onClear}>Clear</button>}
        </span>
      </div>
      {chosen.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {chosen.map((id, i) => {
            const p = byId.get(id);
            return (
              <button key={id} type="button" onClick={() => onToggle(id)} title="Take off the list"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", borderRadius: 999, padding: "5px 10px", background: accent, color: "#fff", font: "inherit", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                <b>{i + 1}</b>{p.First} {p.Last}<span aria-hidden="true" style={{ opacity: 0.8 }}>×</span>
              </button>
            );
          })}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ position: "absolute", left: 11, top: 11, color: "var(--mut)" }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input type="search" value={search} onChange={(e) => onSearch(e.target.value)} disabled={full}
          placeholder={full ? `List is full (${max}). Take one off to add another.` : "Search your board to add a player"}
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--line)", background: "var(--soft)", color: "var(--fg)", borderRadius: 10, padding: "9px 12px 9px 34px", font: "inherit", fontSize: 13 }} />
      </div>
      {q && !full && (
        <div style={{ marginTop: 6, border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          {results.map((p) => (
            <button key={p.id} type="button" onClick={() => add(p.id)}
              style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "8px 12px", border: "none", borderBottom: "1px solid var(--line)", background: "none", color: "var(--fg)", font: "inherit", fontSize: 13, textAlign: "left", cursor: "pointer" }}>
              <span style={{ color: accent, fontWeight: 900, fontSize: 16, lineHeight: 1 }}>+</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <b>{p.First} {p.Last}</b> <span style={{ color: "var(--mut)" }}>{[p.posLabel, p.School].filter(Boolean).join(" · ")}</span>
              </span>
              <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: "var(--mut)" }}>{ROUND_TAG[p.round] || ""}</span>
            </button>
          ))}
          {!results.length && <div style={{ padding: 12, fontSize: 12, color: "var(--mut)" }}>No one on your board matches.</div>}
        </div>
      )}
    </div>
  );
}
const ROUND_TAG = { "ROUND 1": "R1", "ROUND 2": "R2", "ROUND 3": "R3", "ROUND 4": "R4", "ROUND 5": "R5", "ROUND 6": "R6", "ROUND 7": "R7", UDFA: "UDFA" };

const canShareFiles = () => {
  try {
    return typeof navigator !== "undefined" && !!navigator.canShare
      && navigator.canShare({ files: [new File([new Blob()], "x.png", { type: "image/png" })] });
  } catch { return false; }
};

// prompted: opened by the once-a-day "share it?" after Save (utils/sharePrompt.js).
// baseline: { day, ids } — the earlier save risers / fallers compare with
// (utils/whiteboardLists.js pickBaseline), or null.
function ShareGraphicDialog({ pos, onPos, onClose, board, markers, playerById, placedByPos, bigLists, shortOf, classYear, owner, uid, baseline, prompted = false }) {
  const [listId, setListId] = useState("board");
  const [mode, setMode] = useState("top5");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(""); // the settings key last saved
  const [savingGraphic, setSavingGraphic] = useState(false);
  // The user's picks for each list: { "list|pos": [ids] } — kept in this
  // browser per account and class. A list starts empty — the user adds
  // every player (no suggestions); the graphic shows "ADD PLAYERS BELOW"
  // until they do.
  const picksKey = `wb-lists-${uid || "anon"}-${classYear}`;
  const [picks, setPicks] = useState(() => { try { return JSON.parse(localStorage.getItem(picksKey) || "{}"); } catch { return {}; } });
  const [search, setSearch] = useState("");
  const blobRef = useRef(null);
  const info = listInfo(listId);
  const themed = listId !== "board";
  const modes = themed ? GRAPHIC_MODES.filter((m) => m.id !== "list") : GRAPHIC_MODES;
  const shownMode = themed && mode === "list" ? "top10" : mode;

  // The group in board order: Round 1 top to bottom, then Round 2, …
  // "ALL" is the Big Board's order, each row tagged with its position.
  const players = useMemo(() => ROUNDS.flatMap((round) => (pos === "ALL" ? bigLists[round] || [] : board[round][pos] || []).map((id) => {
    const p = playerById.get(id);
    if (!p) return null;
    const g = groupOf(p);
    return {
      id, First: p.First, Last: p.Last, School: p.School, SchoolShort: shortOf[p.School] || "", round,
      starred: !!markers[id]?.starred, flagged: !!markers[id]?.flagged,
      ...(pos === "ALL" ? { posLabel: g, color: POS_COLORS[g] } : {}),
    };
  }).filter(Boolean)), [board, bigLists, markers, playerById, pos, shortOf]);

  const titles = listTitles(listId, pos);
  // The day it was made, on the graphic (a saved one keeps it).
  const date = useMemo(() => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase(), []);
  const max = shownMode === "top5" ? 5 : 10;
  const pickId = `${listId}|${pos}`;
  const base = useMemo(() => (baseline ? baseline.ids.filter((id) => pos === "ALL" || groupOf(playerById.get(id)) === pos) : null), [baseline, pos, playerById]);
  const moves = useMemo(() => movesFrom(players, base), [players, base]);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  // This list's players: the user's picks (none to start).
  const chosen = useMemo(() => {
    if (!themed) return [];
    return (picks[pickId] || []).filter((id) => byId.has(id)).slice(0, max);
  }, [themed, picks, pickId, byId, max]);
  const setChosen = (ids) => {
    setPicks((prev) => {
      const next = { ...prev };
      if (ids == null) delete next[pickId]; else next[pickId] = ids;
      try { localStorage.setItem(picksKey, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };
  const toggle = (id) => {
    if (chosen.includes(id)) setChosen(chosen.filter((x) => x !== id));
    else if (chosen.length < max) setChosen([...chosen, id]);
  };

  const rows = useMemo(() => {
    if (!themed) return players;
    return chosen.map((id) => ({ ...byId.get(id), pills: listPills(listId, moves, id) }));
  }, [themed, players, chosen, byId, listId, moves]);

  const spec = useMemo(() => rows && ({
    owner, pos, color: POS_COLORS[pos] || SITE_BLUE, classYear, mode: shownMode, players: rows, date,
    ...(themed ? { list: listId, headline: titles.headline, sub: titles.sub } : {}),
  }), [rows, owner, pos, classYear, shownMode, themed, listId, titles.headline, titles.sub, date]);
  const specKey = `${classYear}|${pos}|${listId}|${shownMode}`;

  useEffect(() => {
    if (!spec) { setBusy(true); return undefined; }
    let live = true;
    setBusy(true); setNote("");
    renderGraphic(spec).then((blob) => {
      if (!live) return;
      blobRef.current = blob;
      setUrl(URL.createObjectURL(blob));
    }).catch((e) => { console.error("Whiteboard graphic:", e); if (live) setNote("Couldn't draw the graphic. Try again."); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [spec]);

  // Each new image's object URL is let go once the next replaces it.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const fileName = `we-draft-${classYear}-${pos.toLowerCase()}-${themed ? listId : mode}.png`;
  const share = async () => {
    const file = new File([blobRef.current], fileName, { type: "image/png" });
    try { await navigator.share({ files: [file] }); }
    catch (e) { if (e?.name !== "AbortError") setNote("Couldn't open sharing. Use Download instead."); }
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blobRef.current })]);
      setNote("Copied. Paste it into a text or a post.");
    } catch { setNote("This browser can't copy images. Use Download."); }
  };
  // Save to the account (utils/savedGraphics.js): the profile's Boards tab.
  const keep = async () => {
    if (!uid || !spec) return;
    setSavingGraphic(true);
    try {
      const name = themed ? info.label : (GRAPHIC_MODES.find((m) => m.id === mode) || {}).label;
      await saveGraphic(uid, spec, `${pos === "ALL" ? "All positions" : pos} · ${name}`);
      setSaved(specKey);
      setNote("Saved to your account. Find it in Profile → Boards.");
    } catch (e) {
      console.error("Save graphic:", e);
      setNote("Couldn't save it. Try again.");
    } finally { setSavingGraphic(false); }
  };
  const fileShare = canShareFiles();
  const canCopy = typeof window !== "undefined" && !!window.ClipboardItem && !!navigator.clipboard?.write;
  // A themed list with nobody on it is only a preview — nothing to share yet.
  const ready = !busy && !!url && (!themed || chosen.length > 0);
  const isSaved = saved === specKey;

  // The site's share dialog (components/ShareSheet.jsx); the list, position
  // and size as chips under the preview.
  return (
    <ShareSheet open onClose={onClose} title={prompted ? "Board saved — share it?" : "Share a graphic"}
      subtitle={prompted ? "Pick a list and a position, then post or save it." : undefined}
      preview={<div style={{ opacity: busy && url ? 0.5 : 1, transition: "opacity .15s" }}><ShareImagePreview src={url} alt={`Your ${pos} ${themed ? info.label : "board"} graphic`} failed={!url && !busy && !!note} failedText={note} /></div>}
      below={<>
        <WbSelect id="wb-list-type" label="List" value={listId} dot={themed ? info.color : null}
          onChange={(v) => { setListId(v); setSearch(""); setNote(""); }}
          options={WB_LISTS.map((l) => ({ id: l.id, label: l.label }))} />
        <WbSelect id="wb-position" label="Position" value={pos} dot={POS_COLORS[pos] || null}
          onChange={(v) => { onPos(v); setSearch(""); }}
          options={["ALL", ...POSITIONS].map((p) => ({ id: p, label: p === "ALL" ? "All positions" : p,
            disabled: p === "ALL" ? !Object.values(placedByPos).some(Boolean) : !placedByPos[p] }))} />
        <ShareChips label="Graphic" value={shownMode} onChange={setMode} options={modes.map((m) => ({ id: m.id, label: m.label }))} />
        {themed && (
          <ListPicker accent={info.color} players={players} chosen={chosen} max={max} search={search} onSearch={setSearch}
            onToggle={toggle} onClear={() => setChosen([])} />
        )}
      </>}
      primary={[
        { label: "Save image", icon: "download", onClick: download, disabled: !ready },
        ...(fileShare ? [{ label: "Share image", icon: "share", onClick: share, disabled: !ready, alt: true }] : []),
      ]}
      actions={[
        ...(uid ? [{ key: "keep", label: isSaved ? "Saved to account" : savingGraphic ? "Saving…" : "Save to account", icon: isSaved ? "check" : "bookmark", onClick: keep, disabled: !ready || isSaved || savingGraphic }] : []),
        ...(canCopy && !fileShare ? [{ key: "copyimg", label: "Copy image", icon: "copy", onClick: copy, disabled: !ready }] : []),
      ]}
      note={url || isSaved ? note : ""} />
  );
}
