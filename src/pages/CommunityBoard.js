import React, { useEffect, useState, useRef } from "react";
import { collection, getDocs, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";
import Logo1 from "../assets/Logo1.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const gradeOrder = [
  "Watchlist",
  "Early First Round",
  "Middle First Round",
  "Late First Round",
  "Second Round",
  "Third Round",
  "Fourth Round",
  "Fifth Round",
  "Sixth Round",
  "Seventh Round",
  "UDFA",
];

const commGradeOrder = [
  "Early First Round",
  "Middle First Round",
  "Late First Round",
  "Second Round",
  "Third Round",
  "Fourth Round",
  "Fifth Round",
  "Sixth Round",
  "Seventh Round",
  "UDFA",
];

const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
  "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
  "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, UDFA: 10,
};

const gradeLabels = {
  1: "Early First Round", 2: "Middle First Round", 3: "Late First Round",
  4: "Second Round", 5: "Third Round", 6: "Fourth Round",
  7: "Fifth Round", 8: "Sixth Round", 9: "Seventh Round", 10: "UDFA",
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

// Fixed-size grade badge — every badge identical dimensions
const GradeBadge = ({ grade, small = false }) => {
  const w = small ? "48px" : "64px";
  const h = small ? "40px" : "52px";
  const numSz = small ? "16px" : "20px";
  const lblSz = small ? "6px" : "7.5px";
  const gd = gradeDisplay(grade);
  if (!gd) return (
    <div style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: w, height: h, border: "2px solid #ddd", borderRadius: "5px",
      color: "#ccc", fontSize: small ? "14px" : "18px", fontWeight: 900,
    }}>—</div>
  );
  return (
    <div style={{
      display: "inline-flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", backgroundColor: gd.bg, border: `2px solid ${gd.border}`,
      borderRadius: "5px", width: w, height: h, flexShrink: 0,
    }}>
      <span style={{ fontSize: numSz, fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.02em" }}>
        {gd.short}
      </span>
      <span style={{ fontSize: lblSz, fontWeight: 800, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "2px", textAlign: "center", lineHeight: 1.1 }}>
        {grade}
      </span>
    </div>
  );
};

// Plus button — same fixed size as grade badge
const PlusBadge = ({ onClick, loading, small = false }) => {
  const w = small ? "48px" : "64px";
  const h = small ? "40px" : "52px";
  return (
    <div
      onClick={loading ? undefined : onClick}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: w, height: h, border: `2px solid ${BLUE}`, borderRadius: "5px",
        cursor: loading ? "default" : "pointer", backgroundColor: "#fff",
        color: BLUE, fontSize: small ? "18px" : "22px", fontWeight: 900,
        opacity: loading ? 0.4 : 1, transition: "background 0.15s", flexShrink: 0,
      }}
      onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = "#e6f0fa"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
    >+</div>
  );
};

const formatHeight = (inches) => {
  if (!inches) return "-";
  const ft = Math.floor(inches / 12);
  const inch = Math.round((inches % 12) * 10) / 10;
  return `${ft}'${inch}"`;
};

const parseHeight = (val) => {
  if (!val) return NaN;
  if (typeof val === "number") return val;
  const match = String(val).match(/^(\d+)'([\d.]+)"/);
  if (match) return parseInt(match[1], 10) * 12 + parseFloat(match[2]);
  return NaN;
};

// ── Dropdown checklist ───────────────────────────────────────────────────────
function DropdownChecklist({ title, options, selected, setSelected, ordered = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (o) => setSelected((prev) => prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]);
  const sorted = ordered ? options : [...options].sort();

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: "8px 16px", fontWeight: 900, fontSize: "13px",
          textTransform: "uppercase", letterSpacing: "0.05em",
          color: "#fff", background: BLUE, border: `2px solid ${GOLD}`,
          borderRadius: "8px", cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        {title}{selected.length > 0 ? ` (${selected.length})` : ""} ▾
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          zIndex: 50, width: "220px", maxHeight: "300px", overflowY: "auto",
          background: "#fff", border: `2px solid ${GOLD}`, borderRadius: "8px",
          boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", background: BLUE, color: "#fff",
            fontSize: "12px", fontWeight: 900, flexShrink: 0,
          }}>
            <span style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>{title}</span>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setSelected(options)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontWeight: 800, fontSize: "12px", textDecoration: "underline" }}>All</button>
              <button onClick={() => setSelected([])} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontWeight: 800, fontSize: "12px", textDecoration: "underline" }}>Clear</button>
            </div>
          </div>
          <div style={{ height: "3px", background: GOLD, flexShrink: 0 }} />
          <div style={{ padding: "10px 12px" }}>
            {sorted.map((o) => (
              <label key={o} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", cursor: "pointer", fontSize: "14px", fontWeight: 700 }}>
                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} style={{ accentColor: BLUE, width: "14px", height: "14px" }} />
                {o}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function CommunityBoard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [boardDropdownOpen, setBoardDropdownOpen] = useState(false);
  const boardDropdownRef = useRef(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (boardDropdownRef.current && !boardDropdownRef.current.contains(e.target))
        setBoardDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // board state: Map of playerId -> grade string
  const [boardMap, setBoardMap] = useState(new Map());
  const [addingId, setAddingId] = useState(null);

  const [sortKey, setSortKey] = useState("CommunityGrade");
  const [sortOrder, setSortOrder] = useState("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSchools, setSelectedSchools] = useState([]);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [selectedCommGrades, setSelectedCommGrades] = useState([]);
  const [selectedMyGrades, setSelectedMyGrades] = useState([]);
  const [showMyBoardOnly, setShowMyBoardOnly] = useState(false);
  const [eligibleYear, setEligibleYear] = useState("2026");

  // Fetch players + community grades
  useEffect(() => {
    const fetchPlayers = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "players"));
        const data = await Promise.all(
          snap.docs.map(async (docSnap) => {
            const p = { id: docSnap.id, ...docSnap.data() };
            const fortyKey = Object.keys(p).find((k) => k.replace(/\s/g, "") === "40Yard");
            if (fortyKey) p["40 Yard"] = p[fortyKey];
            if (p.Height) p.HeightInches = parseHeight(p.Height);
            try {
              const evalsSnap = await getDocs(collection(db, "players", docSnap.id, "evaluations"));
              const grades = [];
              evalsSnap.forEach((d) => {
                const g = d.data().grade;
                if (g && gradeScale[g]) grades.push(gradeScale[g]);
              });
              p.CommunityGrade = grades.length > 0
                ? gradeLabels[Math.round(grades.reduce((a, b) => a + b, 0) / grades.length)]
                : "-";
            } catch {
              p.CommunityGrade = "-";
            }
            return p;
          })
        );
        setPlayers(data);
      } catch (err) {
        console.error("Error fetching players:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchPlayers();
  }, []);

  // Fetch user's board — store as Map(playerId -> grade)
  useEffect(() => {
    const fetchBoard = async () => {
      if (!user?.uid) { setBoardMap(new Map()); return; }
      try {
        const snap = await getDocs(collection(db, "users", user.uid, "evaluations"));
        const m = new Map();
        snap.docs.forEach((d) => m.set(d.id, d.data().grade || "Watchlist"));
        setBoardMap(m);
      } catch (err) {
        console.error("Error fetching board:", err);
      }
    };
    fetchBoard();
  }, [user]);

  const handleAddToBoard = async (p) => {
    if (!user) return alert("Sign in to add players to your board.");
    if (boardMap.has(p.id)) return;
    setAddingId(p.id);
    try {
      const evalData = {
        uid: user.uid, email: user.email,
        playerId: p.id,
        playerName: `${p.First || ""} ${p.Last || ""}`.trim(),
        grade: "Watchlist", strengths: [], weaknesses: [],
        nflFit: "", evaluation: "", visibility: "private",
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, "players", p.id, "evaluations", user.uid), evalData);
      await setDoc(doc(db, "users", user.uid, "evaluations", p.id), evalData);
      setBoardMap((prev) => new Map([...prev, [p.id, "Watchlist"]]));
    } catch (err) {
      console.error("Error adding to board:", err);
      alert("Failed to add player. Try again.");
    } finally {
      setAddingId(null);
    }
  };

  const handleSort = (key) => {
    if (sortKey === key) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortOrder("asc"); }
  };

  useEffect(() => {
    if (showMyBoardOnly) {
      setSortKey("MyGrade");
      setSortOrder("asc");
    } else {
      setSortKey("CommunityGrade");
      setSortOrder("asc");
    }
  }, [showMyBoardOnly]);

  const resetFilters = () => {
    setSelectedSchools([]); setSelectedPositions([]);
    setSelectedCommGrades([]); setSelectedMyGrades([]);
    setSearchQuery(""); setShowMyBoardOnly(false);
    setEligibleYear("2026");
  };

  const hasActiveFilters = selectedPositions.length > 0 || selectedSchools.length > 0 ||
    selectedCommGrades.length > 0 || selectedMyGrades.length > 0 || searchQuery || showMyBoardOnly;

  const filteredPlayers = players
    .filter((p) => p.Eligible ? p.Eligible.toString() === eligibleYear : true)
    .filter((p) => !searchQuery.trim() ? true : `${p.First || ""} ${p.Last || ""}`.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    .filter((p) => selectedPositions.length === 0 ? true : selectedPositions.includes(p.Position))
    .filter((p) => selectedSchools.length === 0 ? true : selectedSchools.includes(p.School))
    .filter((p) => selectedCommGrades.length === 0 ? true : selectedCommGrades.includes(p.CommunityGrade))
    .filter((p) => {
      if (selectedMyGrades.length === 0) return true;
      const myGrade = boardMap.get(p.id);
      return myGrade ? selectedMyGrades.includes(myGrade) : false;
    })
    .filter((p) => showMyBoardOnly ? boardMap.has(p.id) : true);

  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    if (sortKey === "CommunityGrade") {
      // no grade → sort to bottom always
      const aV = gradeScale[a.CommunityGrade];
      const bV = gradeScale[b.CommunityGrade];
      if (aV && bV) return sortOrder === "asc" ? aV - bV : bV - aV;
      if (aV && !bV) return sortOrder === "asc" ? -1 : 1;
      if (!aV && bV) return sortOrder === "asc" ? 1 : -1;
      return (a.Last || "").localeCompare(b.Last || "");
    }
    if (sortKey === "MyGrade") {
      // Watchlist = 11 (below UDFA=10), not on board = 999
      const myGradeOrder = {
        "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
        "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
        "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9,
        "UDFA": 10, "Watchlist": 11,
      };
      const aG = boardMap.get(a.id), bG = boardMap.get(b.id);
      const aV = aG !== undefined ? (myGradeOrder[aG] ?? 99) : 999;
      const bV = bG !== undefined ? (myGradeOrder[bG] ?? 99) : 999;
      return sortOrder === "asc" ? aV - bV : bV - aV;
    }
    if (sortKey === "Player") {
      const cmp = (a.Last || "").localeCompare(b.Last || "");
      if (cmp !== 0) return sortOrder === "asc" ? cmp : -cmp;
      return sortOrder === "asc"
        ? (a.First || "").localeCompare(b.First || "")
        : (b.First || "").localeCompare(a.First || "");
    }
    if (sortKey === "Height") {
      const aV = a.HeightInches, bV = b.HeightInches;
      const aH = !isNaN(aV), bH = !isNaN(bV);
      if (aH && bH) return sortOrder === "asc" ? aV - bV : bV - aV;
      if (aH) return -1; if (bH) return 1; return 0;
    }
    if (sortKey === "Weight") {
      const aV = parseFloat(a.Weight), bV = parseFloat(b.Weight);
      const aH = !isNaN(aV), bH = !isNaN(bV);
      if (aH && bH) return sortOrder === "asc" ? aV - bV : bV - aV;
      if (aH) return -1; if (bH) return 1; return 0;
    }
    const aV = (a[sortKey] || "").toString().toLowerCase();
    const bV = (b[sortKey] || "").toString().toLowerCase();
    if (aV < bV) return sortOrder === "asc" ? -1 : 1;
    if (aV > bV) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  const allPositions = [...new Set(players.map((p) => p.Position).filter(Boolean))].sort();
  const allSchools = [...new Set(players.map((p) => p.School).filter(Boolean))].sort();

  const SortHeader = ({ sortK, label, align = "center", minWidth }) => (
    <th
      onClick={() => handleSort(sortK)}
      style={{
        padding: "12px 14px", fontWeight: 900, fontSize: "14px",
        textTransform: "uppercase", letterSpacing: "0.06em",
        background: BLUE, color: "#fff", border: `1px solid ${GOLD}`,
        cursor: "pointer", whiteSpace: "nowrap", textAlign: align,
        userSelect: "none", minWidth: minWidth || "auto",
      }}
    >
      {label}{sortKey === sortK ? (sortOrder === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", fontSize: 20, fontWeight: 900, color: BLUE, fontFamily: "'Arial Black', Arial, sans-serif" }}>
        Loading Board...
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Community Board | We-Draft</title>
      </Helmet>

      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: isMobile ? "10px 10px 60px" : "24px 16px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== Page Header ===== */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", marginBottom: "6px" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "26px" : "32px", objectFit: "contain" }} />
            <div style={{ fontSize: isMobile ? "20px" : "26px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, lineHeight: 1 }}>
              Community Board
            </div>
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {/* ===== Year Selector ===== */}
        <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "14px" }}>
          {["2026", "2027", "2028"].map((yr) => (
            <button key={yr} onClick={() => setEligibleYear(yr)} style={{
              border: `2px solid ${GOLD}`, borderRadius: "20px",
              padding: isMobile ? "6px 20px" : "8px 28px",
              fontWeight: 900, fontSize: isMobile ? "14px" : "16px",
              cursor: "pointer",
              background: eligibleYear === yr ? BLUE : "#fff",
              color: eligibleYear === yr ? "#fff" : BLUE,
            }}>
              {yr}
            </button>
          ))}
        </div>

        {/* ===== Filters row ===== */}
        {isMobile ? (
          <div style={{ marginBottom: "12px" }}>
            {/* 2-column grid of filter buttons */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "6px" }}>
              <DropdownChecklist title="Position" options={allPositions} selected={selectedPositions} setSelected={setSelectedPositions} />
              <DropdownChecklist title="School" options={allSchools} selected={selectedSchools} setSelected={setSelectedSchools} />
              <DropdownChecklist title="My Grade" options={gradeOrder} selected={selectedMyGrades} setSelected={setSelectedMyGrades} ordered />
              <DropdownChecklist title="Comm Grade" options={commGradeOrder} selected={selectedCommGrades} setSelected={setSelectedCommGrades} ordered />
            </div>
            {/* My Board + Search on same row */}
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <BoardDropdown dropdownRef={boardDropdownRef} open={boardDropdownOpen} setOpen={setBoardDropdownOpen} active={showMyBoardOnly} setActive={setShowMyBoardOnly} isMobile={isMobile} onNavigate={() => navigate("/whiteboard")} />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search player..."
                style={{ flex: 1, border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "8px 12px", fontWeight: 700, fontSize: "13px", color: BLUE, outline: "none" }} />
              {hasActiveFilters && (
                <button onClick={resetFilters} style={{ background: "none", border: "none", color: "#999", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline", flexShrink: 0 }}>Reset</button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "16px" }}>
            <DropdownChecklist title="Position" options={allPositions} selected={selectedPositions} setSelected={setSelectedPositions} />
            <DropdownChecklist title="School" options={allSchools} selected={selectedSchools} setSelected={setSelectedSchools} />
            <DropdownChecklist title="My Grade" options={gradeOrder} selected={selectedMyGrades} setSelected={setSelectedMyGrades} ordered />
            <DropdownChecklist title="Comm Grade" options={commGradeOrder} selected={selectedCommGrades} setSelected={setSelectedCommGrades} ordered />
            <BoardDropdown dropdownRef={boardDropdownRef} open={boardDropdownOpen} setOpen={setBoardDropdownOpen} active={showMyBoardOnly} setActive={setShowMyBoardOnly} isMobile={isMobile} onNavigate={() => navigate("/whiteboard")} />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search player..."
              style={{ border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "8px 14px", fontWeight: 700, fontSize: "13px", color: BLUE, outline: "none", width: "190px" }} />
            {hasActiveFilters && (
              <button onClick={resetFilters} style={{ background: "none", border: "none", color: "#999", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Reset</button>
            )}
          </div>
        )}

        {/* ===== Table Card ===== */}
        <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
          {/* Card top bar */}
          <div style={{ background: BLUE, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {eligibleYear} Draft Class
            </div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px", fontWeight: 700 }}>
              {sortedPlayers.length} player{sortedPlayers.length !== 1 ? "s" : ""}
            </div>
          </div>
          <div style={{ height: "3px", background: GOLD }} />

          {isMobile ? (
            // ── Mobile: card list ──────────────────────────────────────────
            <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
              {sortedPlayers.length === 0 ? (
                <div style={{ padding: "28px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>
                  No players match your filters.
                </div>
              ) : sortedPlayers.map((p, i) => {
                const myGrade = boardMap.get(p.id);
                const onBoard = myGrade !== undefined;
                const isAdding = addingId === p.id;
                return (
                  <div key={p.id} style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "10px 12px", background: "#fff",
                    borderBottom: `1px solid ${GOLD}`,
                  }}>
                    {/* Left: player info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Link to={`/player/${p.Slug}`} style={{ color: BLUE, fontWeight: 900, fontSize: "15px", textDecoration: "none", display: "block", lineHeight: 1.2 }}>
                        {`${p.First || ""} ${p.Last || ""}`}
                      </Link>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#555", marginTop: "3px" }}>
                        {p.Position || "—"} · {p.School || "—"}
                      </div>
                      {(p.HeightInches || p.Weight) && (
                        <div style={{ fontSize: "11px", color: "#aaa", fontWeight: 700, marginTop: "2px" }}>
                          {p.HeightInches ? formatHeight(p.HeightInches) : ""}{p.HeightInches && p.Weight ? " · " : ""}{p.Weight ? `${p.Weight} lbs` : ""}
                        </div>
                      )}
                    </div>

                    {/* Right: grade badges */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
                      <div style={{ fontSize: "8px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>My</div>
                      {isAdding ? (
                        <div style={{ width: "48px", height: "40px", border: `2px solid ${BLUE}`, borderRadius: "5px", opacity: 0.4 }} />
                      ) : onBoard ? (
                        <GradeBadge grade={myGrade} small />
                      ) : (
                        <PlusBadge onClick={() => handleAddToBoard(p)} loading={isAdding} small />
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
                      <div style={{ fontSize: "8px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>Comm</div>
                      <GradeBadge grade={p.CommunityGrade} small />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // ── Desktop: table ─────────────────────────────────────────────
            <div style={{ overflowX: "auto", maxHeight: "680px", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "center" }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                  <tr>
                    <SortHeader sortK="Player" label="Player" align="left" minWidth="200px" />
                    <SortHeader sortK="Position" label="Pos" />
                    <SortHeader sortK="School" label="School" />
                    <SortHeader sortK="MyGrade" label="My Grade" />
                    <SortHeader sortK="CommunityGrade" label="Comm Grade" />
                    <SortHeader sortK="Height" label="HT" />
                    <SortHeader sortK="Weight" label="WT" />
                  </tr>
                </thead>
                <tbody>
                  {sortedPlayers.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: "32px", color: "#999", fontStyle: "italic", fontSize: "14px", background: "#fff" }}>
                        No players match your filters.
                      </td>
                    </tr>
                  ) : sortedPlayers.map((p) => {
                    const myGrade = boardMap.get(p.id);
                    const onBoard = myGrade !== undefined;
                    const isAdding = addingId === p.id;
                    return (
                      <tr key={p.id}
                        onMouseEnter={(e) => { Array.from(e.currentTarget.cells).forEach((c) => c.style.background = "#e6f0fa"); }}
                        onMouseLeave={(e) => { Array.from(e.currentTarget.cells).forEach((c) => c.style.background = "#fff"); }}
                      >
                        <td style={{ padding: "12px 14px", border: `1px solid ${GOLD}`, background: "#fff", textAlign: "left" }}>
                          <Link to={`/player/${p.Slug}`} style={{ color: BLUE, fontWeight: 900, textDecoration: "none", fontSize: "17px" }}
                            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}>
                            {`${p.First || ""} ${p.Last || ""}`}
                          </Link>
                        </td>
                        <td style={{ padding: "12px 14px", border: `1px solid ${GOLD}`, background: "#fff", fontSize: "16px", fontWeight: 700 }}>{p.Position || "-"}</td>
                        <td style={{ padding: "12px 14px", border: `1px solid ${GOLD}`, background: "#fff", fontSize: "16px", fontWeight: 700 }}>{p.School || "-"}</td>
                        <td style={{ padding: "10px 12px", border: `1px solid ${GOLD}`, background: "#fff" }}>
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            {isAdding ? (
                              <div style={{ width: "64px", height: "52px", border: `2px solid ${BLUE}`, borderRadius: "5px", opacity: 0.4 }} />
                            ) : onBoard ? (
                              <GradeBadge grade={myGrade} />
                            ) : (
                              <PlusBadge onClick={() => handleAddToBoard(p)} loading={isAdding} />
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px", border: `1px solid ${GOLD}`, background: "#fff" }}>
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            <GradeBadge grade={p.CommunityGrade} />
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px", border: `1px solid ${GOLD}`, background: "#fff", fontSize: "16px", fontWeight: 700 }}>
                          {p.HeightInches ? formatHeight(p.HeightInches) : (p.Height || "-")}
                        </td>
                        <td style={{ padding: "10px 12px", border: `1px solid ${GOLD}`, background: "#fff", fontSize: "16px", fontWeight: 700 }}>
                          {p.Weight || "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!user && (
          <p style={{ textAlign: "center", marginTop: "14px", fontSize: "13px", color: "#999", fontWeight: 700 }}>
            Sign in to add players to your board
          </p>
        )}

      </div>
    </>
  );
}

// ── My Board dropdown (top-level component) ──────────────────────────────────
function BoardDropdown({ dropdownRef, open, setOpen, active, setActive, isMobile, onNavigate }) {
  return (
    <div ref={dropdownRef} style={{ position: "relative", display: "inline-block", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        style={{
          padding: isMobile ? "8px 14px" : "8px 16px",
          fontWeight: 900, fontSize: isMobile ? "12px" : "13px",
          textTransform: "uppercase", letterSpacing: "0.05em",
          border: `2px solid ${GOLD}`, borderRadius: "8px", cursor: "pointer",
          background: active ? GOLD : "#fff",
          color: active ? "#fff" : BLUE, whiteSpace: "nowrap",
        }}
      >
        {active ? "✓ My Board" : "My Board"} ▾
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          zIndex: 50, minWidth: "180px",
          background: "#fff", border: `2px solid ${GOLD}`, borderRadius: "8px",
          boxShadow: "0 6px 16px rgba(0,0,0,0.12)", overflow: "hidden",
        }}>
          <div style={{ background: BLUE, padding: "8px 12px", fontSize: "12px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            My Board
          </div>
          <div style={{ height: "3px", background: GOLD }} />
          <div
            onClick={() => { setActive((prev) => !prev); setOpen(false); }}
            style={{
              padding: "11px 14px", cursor: "pointer", fontWeight: 800,
              fontSize: "14px", color: BLUE,
              background: active ? "#f0f5ff" : "#fff",
              display: "flex", alignItems: "center", gap: "8px",
              borderBottom: "1px solid #eee",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = active ? "#f0f5ff" : "#fff"; }}
          >
            {active && <span style={{ color: GOLD, fontWeight: 900 }}>✓</span>}
            Filter My Board
          </div>
          <div
            onClick={() => { setOpen(false); onNavigate(); }}
            style={{
              padding: "11px 14px", cursor: "pointer", fontWeight: 800,
              fontSize: "14px", color: BLUE, background: "#fff",
              display: "flex", alignItems: "center", gap: "8px",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
          >
            Open Whiteboard ↗
          </div>
        </div>
      )}
    </div>
  );
}