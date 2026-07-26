import React, { useEffect, useState, useRef } from "react";
import { collection, getDocs, doc, setDoc, serverTimestamp, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";
import Logo1 from "../assets/Logo1.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const ARCHIVE_YEARS = ["2026"];
const ACTIVE_YEARS = ["2027", "2028", "2029"];

const gradeOrder = [
  "Watchlist",
  "Early First Round", "Middle First Round", "Late First Round",
  "Second Round", "Third Round", "Fourth Round",
  "Fifth Round", "Sixth Round", "Seventh Round", "UDFA",
];

const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
  "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
  "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, UDFA: 10,
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

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

const GradeBadge = ({ grade, small = false }) => {
  const w = small ? "48px" : "64px";
  const h = small ? "40px" : "52px";
  const numSz = small ? "14px" : "18px";
  const lblSz = small ? "5.5px" : "7px";
  const gd = gradeDisplay(grade);
  if (!gd) return (
    <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: w, height: h, border: "2px solid #ddd", borderRadius: "5px", color: "#ccc", fontSize: small ? "14px" : "18px", fontWeight: 900 }}>—</div>
  );
  const isFirstRound = ["Early First Round", "Middle First Round", "Late First Round"].includes(grade);
  const qualifier = isFirstRound ? grade.replace(" First Round", "").toUpperCase() : null;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: gd.bg, border: `2px solid ${gd.border}`, borderRadius: "5px", width: w, height: h, flexShrink: 0, gap: "1px" }}>
      {qualifier && <span style={{ fontSize: small ? "6px" : "7.5px", fontWeight: 900, color: "rgba(255,255,255,0.9)", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1, textAlign: "center" }}>{qualifier}</span>}
      <span style={{ fontSize: numSz, fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.02em", textAlign: "center" }}>{gd.short}</span>
      <span style={{ fontSize: lblSz, fontWeight: 800, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center", lineHeight: 1.1 }}>
        {grade === "Watchlist" ? "LIST" : "ROUND"}
      </span>
    </div>
  );
};

const PlusBadge = ({ onClick, loading, small = false }) => {
  const w = small ? "48px" : "64px";
  const h = small ? "40px" : "52px";
  return (
    <div onClick={loading ? undefined : onClick}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: w, height: h, border: `2px solid ${BLUE}`, borderRadius: "5px", cursor: loading ? "default" : "pointer", backgroundColor: "#fff", color: BLUE, fontSize: small ? "18px" : "22px", fontWeight: 900, opacity: loading ? 0.4 : 1, transition: "background 0.15s", flexShrink: 0 }}
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
      <button onClick={() => setOpen(!open)} style={{ padding: "8px 16px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em", color: "#fff", background: BLUE, border: `2px solid ${GOLD}`, borderRadius: "8px", cursor: "pointer", whiteSpace: "nowrap" }}>
        {title}{selected.length > 0 ? ` (${selected.length})` : ""} ▾
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, width: "220px", maxHeight: "300px", overflowY: "auto", background: "#fff", border: `2px solid ${GOLD}`, borderRadius: "8px", boxShadow: "0 6px 16px rgba(0,0,0,0.12)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: BLUE, color: "#fff", fontSize: "12px", fontWeight: 900 }}>
            <span style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>{title}</span>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setSelected(options)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontWeight: 800, fontSize: "12px", textDecoration: "underline" }}>All</button>
              <button onClick={() => setSelected([])} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontWeight: 800, fontSize: "12px", textDecoration: "underline" }}>Clear</button>
            </div>
          </div>
          <div style={{ height: "3px", background: GOLD }} />
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

function PositionFilterBar({ options, selected, setSelected, isMobile }) {
  const toggle = (pos) => setSelected((prev) => prev.includes(pos) ? prev.filter((x) => x !== pos) : [...prev, pos]);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", marginBottom: isMobile ? "8px" : "18px" }}>
      {options.map((pos) => {
        const active = selected.includes(pos);
        return (
          <button
            key={pos}
            onClick={() => toggle(pos)}
            style={{
              padding: isMobile ? "10px 20px" : "14px 32px",
              fontWeight: 900, fontSize: isMobile ? "16px" : "19px",
              textTransform: "uppercase", letterSpacing: "0.05em",
              border: `3px solid ${GOLD}`, borderRadius: "10px", cursor: "pointer",
              background: active ? BLUE : "#fff",
              color: active ? "#fff" : BLUE,
              whiteSpace: "nowrap", transition: "background 0.15s, color 0.15s",
            }}
          >
            {pos}
          </button>
        );
      })}
    </div>
  );
}

function ArchiveDropdown({ eligibleYear, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const isArchive = ARCHIVE_YEARS.includes(eligibleYear);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen((v) => !v)} style={{ border: `2px solid ${GOLD}`, borderRadius: "20px", padding: "6px 18px", fontWeight: 900, fontSize: "14px", cursor: "pointer", background: isArchive ? BLUE : "#fff", color: isArchive ? "#fff" : BLUE, display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
        {isArchive ? `Archive: ${eligibleYear}` : "Archive"} ▾
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", zIndex: 50, minWidth: "160px", background: "#fff", border: `2px solid ${GOLD}`, borderRadius: "10px", boxShadow: "0 6px 20px rgba(0,0,0,0.14)", overflow: "hidden" }}>
          <div style={{ background: BLUE, padding: "8px 14px", fontSize: "11px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.1em" }}>Past Draft Classes</div>
          <div style={{ height: "3px", background: GOLD }} />
          {ARCHIVE_YEARS.map((yr) => (
            <div key={yr} onClick={() => { onSelect(yr); setOpen(false); }}
              style={{ padding: "11px 16px", cursor: "pointer", fontWeight: 900, fontSize: "15px", color: eligibleYear === yr ? "#fff" : BLUE, background: eligibleYear === yr ? BLUE : "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #f0f0f0" }}
              onMouseEnter={(e) => { if (eligibleYear !== yr) e.currentTarget.style.background = "#f0f5ff"; }}
              onMouseLeave={(e) => { if (eligibleYear !== yr) e.currentTarget.style.background = "#fff"; }}
            >
              <span>{yr}</span>
              {eligibleYear === yr && <span style={{ color: GOLD }}>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function UserBoards() {
  const { user, login, profile } = useAuth();
  const navigate = useNavigate();
  const displayName = profile?.username?.trim() || null;
  const boardsTitle = displayName ? `${displayName}'s Boards` : "My Boards";
  const [players, setPlayers] = useState([]);
  const [playerCache, setPlayerCache] = useState({});
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  const [draftMap, setDraftMap] = useState({});
  const [nflTeams, setNflTeams] = useState({});
  const [boardMap, setBoardMap] = useState(new Map());
  const [addingId, setAddingId] = useState(null);

  const [sortKey, setSortKey] = useState("MyGrade");
  const [sortOrder, setSortOrder] = useState("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSchools, setSelectedSchools] = useState([]);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [selectedMyGrades, setSelectedMyGrades] = useState([]);
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  const [eligibleYear, setEligibleYear] = useState("2027");
  const [showWhiteboardTip, setShowWhiteboardTip] = useState(false);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const handleYearSelect = (yr) => {
    setEligibleYear(yr);
    setSearchQuery(""); setSelectedPositions([]); setSelectedSchools([]);
    setSelectedMyGrades([]); setShowAvailableOnly(false);
    setSortKey("MyGrade"); setSortOrder("asc");
  };

  // Fetch NFL teams
  useEffect(() => {
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "nfl"));
        const map = {};
        snap.docs.forEach((d) => { map[d.id] = d.data(); });
        setNflTeams(map);
      } catch (e) { console.error(e); }
    };
    fetch();
  }, []);

  // Fetch draft order
  useEffect(() => {
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "draftOrder"));
        const map = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data.Selection) map[data.Selection] = { team: data.Team, round: data.Round, pick: data.Pick };
        });
        setDraftMap(map);
      } catch (e) { console.error(e); }
    };
    fetch();
  }, []);

  // Fetch players by year with cache
  useEffect(() => {
    if (playerCache[eligibleYear]) {
      setPlayers(playerCache[eligibleYear]);
      setLoading(false);
      return;
    }
    const fetchPlayers = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(query(collection(db, "players"), where("Eligible", "==", eligibleYear)));
        const data = snap.docs.map((docSnap) => {
          const p = { id: docSnap.id, ...docSnap.data() };
          const fortyKey = Object.keys(p).find((k) => k.replace(/\s/g, "") === "40Yard");
          if (fortyKey) p["40 Yard"] = p[fortyKey];
          if (p.Height) p.HeightInches = parseHeight(p.Height);
          return p;
        });
        setPlayerCache((prev) => ({ ...prev, [eligibleYear]: data }));
        setPlayers(data);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetchPlayers();
  }, [eligibleYear]);

  // Fetch user's board
  useEffect(() => {
    const fetchBoard = async () => {
      if (!user?.uid) { setBoardMap(new Map()); return; }
      try {
        const snap = await getDocs(collection(db, "users", user.uid, "evaluations"));
        const m = new Map();
        snap.docs.forEach((d) => m.set(d.id, d.data().grade || "Watchlist"));
        setBoardMap(m);
      } catch (err) { console.error(err); }
    };
    fetchBoard();
  }, [user]);

  const handleAddToBoard = async (p) => {
    if (!user) return alert("Sign in to add players to your board.");
    if (boardMap.has(p.id)) return;
    setAddingId(p.id);
    try {
      const evalData = {
        uid: user.uid, email: user.email, playerId: p.id,
        playerName: `${p.First || ""} ${p.Last || ""}`.trim(),
        grade: "Watchlist", strengths: [], weaknesses: [],
        nflFit: "", evaluation: "", visibility: "private",
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, "players", p.id, "evaluations", user.uid), evalData);
      await setDoc(doc(db, "users", user.uid, "evaluations", p.id), evalData);
      setBoardMap((prev) => new Map([...prev, [p.id, "Watchlist"]]));
    } catch (err) { console.error(err); alert("Failed to add player. Try again."); }
    finally { setAddingId(null); }
  };

  const handleSort = (key) => {
    if (sortKey === key) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortOrder("asc"); }
  };

  const resetFilters = () => {
    setSelectedSchools([]); setSelectedPositions([]);
    setSelectedMyGrades([]); setSearchQuery("");
    setShowAvailableOnly(false);
    setSortKey("MyGrade"); setSortOrder("asc");
  };

  const hasActiveFilters = selectedPositions.length > 0 || selectedSchools.length > 0 ||
    selectedMyGrades.length > 0 || searchQuery || showAvailableOnly;

  const is2026 = eligibleYear === "2026";
  const is2029 = eligibleYear === "2029";

  const filteredPlayers = players
    .filter((p) => {
      // Show any player the user has on their board (Watchlist or graded)
      return boardMap.has(p.id);
    })
    .filter((p) => !searchQuery.trim() ? true : `${p.First || ""} ${p.Last || ""}`.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    .filter((p) => selectedPositions.length === 0 ? true : selectedPositions.includes(p.Position))
    .filter((p) => selectedSchools.length === 0 ? true : selectedSchools.includes(p.School))
    .filter((p) => {
      if (selectedMyGrades.length === 0) return true;
      const myGrade = boardMap.get(p.id);
      return myGrade ? selectedMyGrades.includes(myGrade) : false;
    })
    .filter((p) => showAvailableOnly ? !draftMap[p.Slug] : true);

  const myGradeOrder = {
    "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
    "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
    "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9,
    "UDFA": 10, "Watchlist": 11,
  };

  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    if (sortKey === "MyGrade") {
      const aG = boardMap.get(a.id), bG = boardMap.get(b.id);
      const aV = aG !== undefined ? (myGradeOrder[aG] ?? 99) : 999;
      const bV = bG !== undefined ? (myGradeOrder[bG] ?? 99) : 999;
      return sortOrder === "asc" ? aV - bV : bV - aV;
    }
    if (sortKey === "Pick") {
      const aD = draftMap[a.Slug], bD = draftMap[b.Slug];
      return sortOrder === "asc" ? (aD?.pick || 9999) - (bD?.pick || 9999) : (bD?.pick || 9999) - (aD?.pick || 9999);
    }
    if (sortKey === "Player") {
      const cmp = (a.Last || "").localeCompare(b.Last || "");
      if (cmp !== 0) return sortOrder === "asc" ? cmp : -cmp;
      return sortOrder === "asc" ? (a.First || "").localeCompare(b.First || "") : (b.First || "").localeCompare(a.First || "");
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

  const POSITION_ORDER = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB"];
  const allPositions = [...new Set(players.map((p) => p.Position).filter(Boolean))].sort(
    (a, b) => {
      const ai = POSITION_ORDER.indexOf(a);
      const bi = POSITION_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
  );
  const allSchools = [...new Set(players.map((p) => p.School).filter(Boolean))].sort();

  // ── Sort label used in the desktop ranked-list header — plain clickable
  // text instead of a table <th>, active column highlighted gold with an
  // always-visible (dimmed when inactive) arrow so sortability reads at a
  // glance. Mirrors the same component built for CommunityBoard.js. ──
  const SortLabel = ({ sortK, label, align = "center", width }) => {
    const active = sortKey === sortK;
    return (
      <div
        onClick={() => handleSort(sortK)}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = active ? "1" : "0.72"; }}
        style={{
          ...(width ? { width, flexShrink: 0 } : { flex: 1, minWidth: 0 }),
          display: "flex", alignItems: "center", gap: "5px",
          justifyContent: align === "left" ? "flex-start" : "center",
          color: active ? GOLD : "#fff",
          fontWeight: 900, fontSize: "13px",
          textTransform: "uppercase", letterSpacing: "0.08em",
          cursor: "pointer", userSelect: "none",
          opacity: active ? 1 : 0.72,
          transition: "opacity 0.15s ease, color 0.15s ease",
        }}
      >
        <span style={{ whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ fontSize: "10px", opacity: active ? 1 : 0.5 }}>
          {active ? (sortOrder === "asc" ? "▲" : "▼") : "▲"}
        </span>
      </div>
    );
  };

  if (!user) return (
    <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: "520px", border: `2px solid ${GOLD}`, borderRadius: "14px", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,85,165,0.14)" }}>
        {/* Header */}
        <div style={{ background: `linear-gradient(135deg, ${BLUE} 0%, #003a7a 100%)`, padding: "28px 32px 24px", textAlign: "center", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "repeating-linear-gradient(55deg, transparent, transparent 18px, rgba(246,162,29,0.06) 18px, rgba(246,162,29,0.06) 36px)", pointerEvents: "none" }} />
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: "42px", marginBottom: "10px" }}>📋</div>
            <div style={{ fontSize: "26px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.1, marginBottom: "8px" }}>
              {boardsTitle}
            </div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: GOLD, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Your Personal Draft Command Center
            </div>
          </div>
        </div>
        <div style={{ height: "4px", background: `linear-gradient(90deg, ${BLUE}, ${GOLD}, ${BLUE})` }} />

        {/* Features list */}
        <div style={{ background: "#fff", padding: "24px 28px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "28px" }}>
            {[
              { icon: "🏈", text: "Build your own personal draft board across every class" },
              { icon: "📊", text: "Grade every prospect and track your evaluations in one place" },
              { icon: "🔍", text: "Filter by position, school, and your own grades" },
              { icon: "📣", text: "See how your takes compare to the We-Draft community" },
            ].map(({ icon, text }) => (
              <div key={text} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontSize: "20px", flexShrink: 0 }}>{icon}</span>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#333", lineHeight: 1.4 }}>{text}</span>
              </div>
            ))}
          </div>

          <button
            onClick={login}
            style={{
              width: "100%", backgroundColor: BLUE, color: "#fff",
              border: `3px solid ${GOLD}`, borderRadius: "10px",
              padding: "16px 32px", fontWeight: 900, fontSize: "17px",
              textTransform: "uppercase", letterSpacing: "0.08em",
              cursor: "pointer", fontFamily: "inherit",
              boxShadow: `0 4px 20px rgba(0,85,165,0.25)`,
              marginBottom: "10px",
            }}
          >
            Sign In to Access My Boards →
          </button>
          <div style={{ textAlign: "center", fontSize: "12px", fontWeight: 700, color: "#aaa" }}>
            Free · Sign in with Google or Email · No spam
          </div>
        </div>
      </div>
    </div>
  );

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", fontSize: 20, fontWeight: 900, color: BLUE, fontFamily: "'Arial Black', Arial, sans-serif" }}>
      Loading Board...
    </div>
  );

  return (
    <>
      <Helmet><title>{boardsTitle} | We-Draft</title></Helmet>

      <div style={{ maxWidth: "1300px", margin: "0 auto", padding: isMobile ? "10px 10px 60px" : "18px 24px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* Page Header */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", marginBottom: "6px" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "26px" : "32px", objectFit: "contain" }} />
            <div style={{ fontSize: displayName ? (isMobile ? "22px" : "32px") : (isMobile ? "20px" : "26px"), fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, lineHeight: 1 }}>{boardsTitle}</div>
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {/* Year Selector */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", marginBottom: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
            <ArchiveDropdown eligibleYear={eligibleYear} onSelect={handleYearSelect} />
            {ACTIVE_YEARS.map((yr) => (
              <button key={yr} onClick={() => handleYearSelect(yr)}
                style={{ border: `2px solid ${GOLD}`, borderRadius: "20px", padding: isMobile ? "6px 20px" : "8px 28px", fontWeight: 900, fontSize: isMobile ? "14px" : "16px", cursor: "pointer", background: eligibleYear === yr ? BLUE : "#fff", color: eligibleYear === yr ? "#fff" : BLUE, transition: "background 0.15s, color 0.15s" }}>
                {yr}
              </button>
            ))}
          </div>
        </div>

        {!is2029 && (
          isMobile ? (
            <PositionFilterBar options={allPositions} selected={selectedPositions} setSelected={setSelectedPositions} isMobile />
          ) : (
            <PositionFilterBar options={allPositions} selected={selectedPositions} setSelected={setSelectedPositions} />
          )
        )}

        {/* 2029 placeholder */}
        {is2029 ? (
          <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ background: BLUE, padding: "8px 16px" }}>
              <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>2029 Draft Class</div>
            </div>
            <div style={{ height: "3px", background: GOLD }} />
            <div style={{ padding: isMobile ? "40px 20px" : "60px 40px", textAlign: "center", background: "#fff" }}>
              <div style={{ fontSize: "40px", marginBottom: "16px" }}>🏈</div>
              <div style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>2029 Players Coming Soon</div>
              <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: "#888", maxWidth: "480px", margin: "0 auto", lineHeight: 1.6 }}>
                The 2029 draft class will be added once the 2026 college football season kicks off.
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Filters */}
            {isMobile ? (
              <div style={{ marginBottom: "12px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "6px" }}>
                  <DropdownChecklist title="School" options={allSchools} selected={selectedSchools} setSelected={setSelectedSchools} />
                  <DropdownChecklist title="My Grade" options={gradeOrder} selected={selectedMyGrades} setSelected={setSelectedMyGrades} ordered />
                </div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  {is2026 && (
                    <button onClick={() => setShowAvailableOnly((v) => !v)}
                      style={{ padding: "8px 12px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em", border: `2px solid ${GOLD}`, borderRadius: "8px", cursor: "pointer", background: showAvailableOnly ? GOLD : "#fff", color: showAvailableOnly ? "#fff" : BLUE, whiteSpace: "nowrap", flexShrink: 0 }}>
                      {showAvailableOnly ? "✓ Available" : "Available"}
                    </button>
                  )}
                  <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search player..."
                    style={{ flex: 1, border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "8px 12px", fontWeight: 700, fontSize: "13px", color: BLUE, outline: "none" }} />
                  <button onClick={resetFilters} style={{ background: "none", border: "none", color: "#999", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline", flexShrink: 0 }}>Reset</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", justifyContent: "center", marginBottom: "16px" }}>
                <DropdownChecklist title="School" options={allSchools} selected={selectedSchools} setSelected={setSelectedSchools} />
                <DropdownChecklist title="My Grade" options={gradeOrder} selected={selectedMyGrades} setSelected={setSelectedMyGrades} ordered />
                {is2026 && (
                  <button onClick={() => setShowAvailableOnly((v) => !v)}
                    style={{ padding: "8px 16px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em", border: `2px solid ${GOLD}`, borderRadius: "8px", cursor: "pointer", background: showAvailableOnly ? GOLD : "#fff", color: showAvailableOnly ? "#fff" : BLUE, whiteSpace: "nowrap" }}>
                    {showAvailableOnly ? "✓ Available" : "Available"}
                  </button>
                )}
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search player..."
                  style={{ border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "8px 14px", fontWeight: 700, fontSize: "13px", color: BLUE, outline: "none", width: "190px" }} />
                <Link to="/community" style={{ padding: "8px 16px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em", color: "#fff", background: GOLD, border: `2px solid ${BLUE}`, borderRadius: "8px", textDecoration: "none", whiteSpace: "nowrap" }}>
                  + Community Board
                </Link>
                <div style={{ position: "relative", display: "inline-block" }}
                  onMouseEnter={() => setShowWhiteboardTip(true)}
                  onMouseLeave={() => setShowWhiteboardTip(false)}
                >
                  <Link to="/whiteboard" style={{ padding: "8px 16px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em", color: "#fff", background: BLUE, border: `2px solid ${GOLD}`, borderRadius: "8px", textDecoration: "none", whiteSpace: "nowrap", display: "inline-block" }}>
                    Whiteboard ↗
                  </Link>
                  {showWhiteboardTip && (
                    <div style={{
                      position: "absolute", top: "calc(100% + 10px)", left: "50%", transform: "translateX(-50%)",
                      width: "220px", background: "#fff", border: `1.5px solid ${BLUE}`,
                      borderRadius: "10px", padding: "10px 14px", boxShadow: "0 12px 28px rgba(0,0,0,0.16)",
                      zIndex: 60, textAlign: "center", pointerEvents: "none",
                    }}>
                      <div style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%) rotate(45deg)", width: "11px", height: "11px", background: "#fff", border: `1.5px solid ${BLUE}`, borderRadius: "2px" }} />
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#444", lineHeight: 1.45 }}>
                        Whiteboard is an easy way to rank players and customize your board.
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={resetFilters} style={{ background: "none", border: "none", color: "#999", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Reset</button>
              </div>
            )}

            {/* Table Card */}
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ background: BLUE, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>{eligibleYear} Draft Class</div>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px", fontWeight: 700 }}>
                  {sortedPlayers.length} player{sortedPlayers.length !== 1 ? "s" : ""}
                </div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />

              {isMobile ? (
                <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
                  {sortedPlayers.length === 0 ? (
                    <div style={{ padding: "28px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>
                      {!hasActiveFilters ? `No ${eligibleYear} players on your board yet. Go to the Community Board and add some players to see them here.` : "No players match your filters."}
                    </div>
                  ) : sortedPlayers.map((p) => {
                    const myGrade = boardMap.get(p.id);
                    const onBoard = myGrade !== undefined;
                    const isAdding = addingId === p.id;
                    const draft = draftMap[p.Slug];
                    const teamData = draft ? nflTeams[draft.team] : null;
                    const c1 = teamData?.Color1 || BLUE;
                    const c2 = teamData?.Color2 || GOLD;
                    return (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: "#fff", borderBottom: `1px solid ${GOLD}` }}>
                        {is2026 && draft && (
                          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
                            <div style={{ width: 32, height: 32, borderRadius: "6px", background: c1, border: `2px solid ${c2}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                              <span style={{ fontSize: "7px", fontWeight: 900, color: "rgba(255,255,255,0.7)", lineHeight: 1 }}>Rd {draft.round}</span>
                              <span style={{ fontSize: "13px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{draft.pick}</span>
                            </div>
                            {teamData?.Logo1 ? (
                              <img src={sanitizeUrl(teamData.Logo1)} alt={draft.team} style={{ width: "24px", height: "24px", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                            ) : (
                              <span style={{ fontSize: "8px", fontWeight: 900, color: c1 }}>{draft.team}</span>
                            )}
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Link to={`/player/${p.Slug}`} style={{ color: BLUE, fontWeight: 900, fontSize: "15px", textDecoration: "none", display: "block", lineHeight: 1.2 }}>
                            {`${p.First || ""} ${p.Last || ""}`}
                          </Link>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "#555", marginTop: "3px" }}>{p.Position || "—"} · {p.School || "—"}</div>
                          {(p.HeightInches || p.Weight) && (
                            <div style={{ fontSize: "11px", color: "#aaa", fontWeight: 700, marginTop: "2px" }}>
                              {p.HeightInches ? formatHeight(p.HeightInches) : ""}{p.HeightInches && p.Weight ? " · " : ""}{p.Weight ? `${p.Weight} lbs` : ""}
                            </div>
                          )}
                        </div>
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
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ maxHeight: "760px", overflowY: "auto" }}>
                  {/* Header row — plain clickable labels instead of table <th> cells,
                      matching the ranked-list style built for CommunityBoard.js. No
                      Comm Grade column here since this page only tracks the user's
                      own grade. */}
                  <div style={{
                    position: "sticky", top: 0, zIndex: 10,
                    display: "flex", alignItems: "center", gap: "16px",
                    background: `linear-gradient(135deg, ${BLUE}, #003d7a)`,
                    padding: "12px 20px",
                  }}>
                    {is2026 && <SortLabel sortK="Pick" label="Pick" width="64px" />}
                    {is2026 && <div style={{ width: "56px", flexShrink: 0 }} />}
                    <SortLabel sortK="Player" label="Player" align="left" />
                    <SortLabel sortK="Position" label="Pos" width="84px" />
                    <SortLabel sortK="MyGrade" label="My Grade" width="140px" />
                    <SortLabel sortK="Height" label="HT" width="70px" />
                    <SortLabel sortK="Weight" label="WT" width="70px" />
                  </div>
                  <div style={{ height: "3px", background: GOLD }} />

                  {sortedPlayers.length === 0 ? (
                    <div style={{ padding: "32px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px", background: "#fff" }}>
                      {!hasActiveFilters ? `No ${eligibleYear} players on your board yet. Go to the Community Board and add some players to see them here.` : "No players match your filters."}
                    </div>
                  ) : sortedPlayers.map((p) => {
                    const myGrade = boardMap.get(p.id);
                    const onBoard = myGrade !== undefined;
                    const isAdding = addingId === p.id;
                    const draft = draftMap[p.Slug];
                    const teamData = draft ? nflTeams[draft.team] : null;
                    const c1 = teamData?.Color1 || BLUE;
                    const c2 = teamData?.Color2 || GOLD;
                    return (
                      <div
                        key={p.id}
                        style={{ display: "flex", alignItems: "center", gap: "16px", padding: "11px 20px", background: "#fff", borderBottom: "1px solid #eee", transition: "background 0.12s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f8ff"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                      >
                        {is2026 && (
                          <div style={{ width: "64px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                            {draft ? (
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "48px", height: "48px", borderRadius: "7px", background: c1, border: `2px solid ${c2}` }}>
                                <span style={{ fontSize: "8px", fontWeight: 900, color: "rgba(255,255,255,0.7)", lineHeight: 1, textTransform: "uppercase" }}>Rd {draft.round}</span>
                                <span style={{ fontSize: "19px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{draft.pick}</span>
                              </div>
                            ) : <span style={{ color: "#ddd" }}>—</span>}
                          </div>
                        )}
                        {is2026 && (
                          <div style={{ width: "56px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                            {teamData?.Logo1 ? (
                              <img src={sanitizeUrl(teamData.Logo1)} alt={draft.team} title={teamData?.Name || draft.team} style={{ width: "40px", height: "40px", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                            ) : draft ? <span style={{ fontSize: "11px", fontWeight: 900, color: c1 }}>{draft.team}</span> : <span style={{ color: "#ddd" }}>—</span>}
                          </div>
                        )}

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Link
                            to={`/player/${p.Slug}`}
                            style={{ color: BLUE, fontWeight: 900, fontSize: "27px", textDecoration: "none", display: "block", lineHeight: 1.15 }}
                            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                          >
                            {`${p.First || ""} ${p.Last || ""}`}
                          </Link>
                          {p.School && (
                            <div style={{ fontSize: "13px", fontWeight: 700, color: "#888", marginTop: "3px" }}>
                              {p.School}
                            </div>
                          )}
                        </div>

                        <div style={{ width: "84px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                          {p.Position ? (
                            <span style={{ fontSize: "14px", fontWeight: 900, color: BLUE, background: "#eaf1ff", padding: "6px 12px", borderRadius: "6px", textTransform: "uppercase" }}>
                              {p.Position}
                            </span>
                          ) : <span style={{ color: "#ddd" }}>—</span>}
                        </div>

                        <div style={{ width: "140px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                          {isAdding ? (
                            <div style={{ width: "64px", height: "52px", border: `2px solid ${BLUE}`, borderRadius: "5px", opacity: 0.4 }} />
                          ) : onBoard ? (
                            <GradeBadge grade={myGrade} />
                          ) : (
                            <PlusBadge onClick={() => handleAddToBoard(p)} loading={isAdding} />
                          )}
                        </div>

                        <div style={{ width: "70px", flexShrink: 0, textAlign: "center", fontSize: "20px", fontWeight: 900, color: "#333" }}>
                          {p.HeightInches ? formatHeight(p.HeightInches) : (p.Height || "-")}
                        </div>

                        <div style={{ width: "70px", flexShrink: 0, textAlign: "center", fontSize: "20px", fontWeight: 900, color: "#333" }}>
                          {p.Weight || "-"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {!user && (
              <p style={{ textAlign: "center", marginTop: "14px", fontSize: "13px", color: "#999", fontWeight: 700 }}>Sign in to add players to your board</p>
            )}
          </>
        )}
      </div>
    </>
  );
}