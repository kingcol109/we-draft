import React, { useEffect, useState, useRef } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";
import LoadingSpinner from "../components/LoadingSpinner";
import { BoardsFeedCard, BoardsFollowCard } from "../components/BoardsMarginSidebars";
import { SideRailAd } from "../components/MarginAds";
import { BOARD_MODERN_STYLE, RANK_CHIP, rankSlotWidth, POS_COL_W, LOGO_COL_W, RankChips, DropdownChecklist, ArchiveDropdown } from "../components/boardKit";
import { averageGradesFor, gradeLabel } from "../utils/communityGrades";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { classSnapshotRanks } from "../utils/classRanks";
import { useMobileStuckPageWatchdog } from "../hooks/useMobileStuckPageWatchdog";

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

// Position chips — the Community Board's look (boardKit's wdb-pill wdb-sel):
// multi-select on desktop, one at a time on phones in a single scrolling row.
function PositionFilterBar({ options, selected, setSelected, isMobile }) {
  const toggle = (pos) => setSelected((prev) => {
    if (!isMobile) return prev.includes(pos) ? prev.filter((x) => x !== pos) : [...prev, pos];
    return prev.includes(pos) ? [] : [pos];
  });
  return (
    <div style={{
      display: "flex", flexWrap: isMobile ? "nowrap" : "wrap", overflowX: isMobile ? "auto" : "visible",
      WebkitOverflowScrolling: "touch", gap: isMobile ? "5px" : "8px",
      justifyContent: isMobile ? "flex-start" : "center", marginBottom: isMobile ? "8px" : "12px",
    }}>
      {options.map((pos) => {
        const active = selected.includes(pos);
        return (
          <button
            key={pos}
            onClick={() => toggle(pos)}
            aria-pressed={active}
            className={"wdb-pill wdb-sel" + (active ? " on" : "")}
            style={{
              flexShrink: 0, padding: isMobile ? "7px 10px" : "8px 18px",
              fontWeight: 900, fontSize: isMobile ? "12px" : "15px", textTransform: "uppercase", letterSpacing: "0.05em",
              border: (isMobile ? "2px" : "3px") + " solid " + GOLD, borderRadius: isMobile ? "8px" : "10px", cursor: "pointer",
              background: active ? BLUE : "#fff", color: active ? "#fff" : BLUE,
              whiteSpace: "nowrap", fontFamily: "inherit",
            }}
          >
            {pos}
          </button>
        );
      })}
    </div>
  );
}

export default function UserBoards() {
  const { user, login, profile } = useAuth();
  const displayName = profile?.username?.trim() || null;
  const boardsTitle = displayName ? `${displayName}'s Boards` : "My Boards";
  const [players, setPlayers] = useState([]);
  const [playerCache, setPlayerCache] = useState({});
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const contentRef = useRef(null);

  const [draftMap, setDraftMap] = useState({});
  const [nflTeams, setNflTeams] = useState({});
  const [boardMap, setBoardMap] = useState(new Map());

  const [sortKey, setSortKey] = useState("MyGrade");
  const [sortOrder, setSortOrder] = useState("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSchools, setSelectedSchools] = useState([]);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [selectedMyGrades, setSelectedMyGrades] = useState([]);
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  const [eligibleYear, setEligibleYear] = useState("2027");
  const [showWhiteboardTip, setShowWhiteboardTip] = useState(false);
  // Same extras the Community Board rows show: class / position rank chips
  // and school logos (the class snapshots), and each board player's
  // community grade.
  const [ranks, setRanks] = useState({});
  const [logoBySchool, setLogoBySchool] = useState({});
  const [commGrades, setCommGrades] = useState({});

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── Same mobile stuck-page reload as PlayerProfile.js/CommunityBoard.js/
  // etc — a backgrounded tab can leave this page's fetch hanging
  // indefinitely, so force a real reload after 3s (or on tab refocus)
  // rather than let it spin forever. Keyed on the selected year so
  // switching years resets it. ──
  useMobileStuckPageWatchdog(loading, `user_boards_${eligibleYear}`, { enabled: isMobile });

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

  // Ranks and school logos: the class snapshots, one per position (cached
  // for the session) — the same numbers and logos the Community Board shows.
  // Schools missing from them get a batched schools lookup.
  useEffect(() => {
    if (!players.length) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const positions = [...new Set(players.map((p) => p.Position).filter(Boolean))];
        const rankDocs = await Promise.all(positions.map((pos) => getSiteSnapshot(`class_${eligibleYear}_${pos}`)));
        const r = Object.assign({}, ...rankDocs.map(classSnapshotRanks));
        const logos = {};
        rankDocs.forEach((d) => (d?.rows || []).forEach((row) => { if (row.s && row.lg) logos[row.s] = row.lg; }));
        const missing = [...new Set(players.filter((p) => boardMap.has(p.id)).map((p) => p.School).filter((s) => s && !(s in logos)))];
        const chunks = [];
        for (let i = 0; i < missing.length; i += 10) chunks.push(missing.slice(i, i + 10));
        const snaps = await Promise.all(chunks.map((c) => getDocs(query(collection(db, "schools"), where("School", "in", c))).catch(() => null)));
        snaps.forEach((s) => (s?.docs || []).forEach((d) => { const sd = d.data(); if (sd.School) logos[sd.School] = sd.Logo1 || ""; }));
        if (cancelled) return;
        setRanks(r);
        setLogoBySchool(logos);
      } catch (e) { console.error("Board ranks/logos:", e); }
    })();
    return () => { cancelled = true; };
  }, [players, eligibleYear, boardMap]);

  // Community grades for just the players on this board.
  useEffect(() => {
    const ids = players.filter((p) => boardMap.has(p.id)).map((p) => p.id);
    if (!ids.length) { setCommGrades({}); return undefined; }
    let cancelled = false;
    averageGradesFor(ids)
      .then((avgs) => {
        if (cancelled) return;
        const out = {};
        ids.forEach((id) => { out[id] = gradeLabel(avgs[id]) || "-"; });
        setCommGrades(out);
      })
      .catch((e) => console.error("Board community grades:", e));
    return () => { cancelled = true; };
  }, [players, boardMap]);

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
    if (sortKey === "ClassRank" || sortKey === "PositionRank") {
      const k = sortKey === "ClassRank" ? "classRank" : "positionRank";
      const aV = ranks[a.id]?.[k] ?? 9999, bV = ranks[b.id]?.[k] ?? 9999;
      return sortOrder === "asc" ? aV - bV : bV - aV;
    }
    if (sortKey === "CommunityGrade") {
      const aV = gradeScale[commGrades[a.id]] ?? 99, bV = gradeScale[commGrades[b.id]] ?? 99;
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
  // ── A sortable column label in the desktop list's header — the same
  // button the Community Board uses (aria-pressed drives the shared style's
  // gold active state). ──
  const SortLabel = ({ sortK, label, align = "center", width, title }) => {
    const active = sortKey === sortK;
    return (
      <button
        type="button"
        onClick={() => handleSort(sortK)}
        title={title}
        aria-label={"Sort by " + (title || label)}
        aria-pressed={active}
        style={{
          ...(width ? { width, flexShrink: 0 } : { flex: 1, minWidth: 0 }),
          display: "flex", alignItems: "center", gap: "5px",
          justifyContent: align === "left" ? "flex-start" : "center",
          color: active ? GOLD : "#fff", fontWeight: 900, fontSize: "13px",
          textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", userSelect: "none",
          opacity: active ? 1 : 0.72, background: "none", border: "none", padding: 0, fontFamily: "inherit",
        }}
      >
        <span style={{ whiteSpace: "nowrap" }}>{label}</span>
        <span aria-hidden="true" style={{ fontSize: "10px", opacity: active ? 1 : 0.5 }}>
          {active ? (sortOrder === "asc" ? "▲" : "▼") : "▲"}
        </span>
      </button>
    );
  };

  if (!user) return (
    <div style={{ minHeight: "calc(70vh / var(--pz, 1))", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
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

  if (loading) return <LoadingSpinner label="Loading Board" size={56} minHeight="calc(100vh / var(--pz, 1))" />;

  const showRanks = sortedPlayers.some((p) => ranks[p.id]);
  const posLabel = selectedPositions.length === 1 ? selectedPositions[0] : "";
  // No community grade yet shows the Watchlist badge, as on the Community Board.
  const displayCommGrade = (g) => (gradeScale[g] ? g : "Watchlist");
  const emptyText = !hasActiveFilters
    ? `No ${eligibleYear} players on your board yet. Go to the Community Board and add some players to see them here.`
    : "No players match your filters.";
  const pillLink = (on) => ({
    padding: "8px 16px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em",
    border: "2px solid " + GOLD, borderRadius: "8px", textDecoration: "none", whiteSpace: "nowrap",
    background: on ? BLUE : "#fff", color: on ? "#fff" : BLUE, display: "inline-block", textAlign: "center",
  });

  const MainContent = (
    <div style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
      {/* Header — the Community Board's compact blue title card. */}
      <div className="wdb-hero" style={{ marginBottom: isMobile ? "10px" : "14px", border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: isMobile ? "10px 12px" : "14px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
          <h1 style={{ fontSize: isMobile ? "22px" : "36px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.03em", color: "#fff", lineHeight: 1.05, textAlign: "center", width: "100%", margin: 0 }}>
            {displayName ? `${displayName}'s ` : "My "}<span style={{ color: GOLD }}>{eligibleYear}{posLabel ? ` ${posLabel}` : ""}</span> Board
          </h1>
          <div style={{ fontSize: isMobile ? "10px" : "12px", fontWeight: 700, color: "rgba(255,255,255,0.8)", letterSpacing: "0.06em", textTransform: "uppercase", textAlign: "center", lineHeight: 1.3 }}>
            {eligibleYear} NFL Draft · My Boards · Ranked by my grades
          </div>
        </div>
        <div className="wdb-stripe" style={{ height: "3px", background: GOLD }} />
      </div>

      {/* Draft class */}
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "6px" : "8px", flexWrap: "wrap", justifyContent: "center", marginBottom: isMobile ? "8px" : "10px" }}>
        <ArchiveDropdown eligibleYear={eligibleYear} onSelect={handleYearSelect} archiveYears={ARCHIVE_YEARS} />
        {ACTIVE_YEARS.map((yr) => (
          <button key={yr} onClick={() => handleYearSelect(yr)} aria-pressed={eligibleYear === yr}
            className={"wdb-pill wdb-sel" + (eligibleYear === yr ? " on" : "")}
            style={{ border: "2px solid " + GOLD, borderRadius: "20px", padding: isMobile ? "6px 18px" : "7px 24px", fontWeight: 900, fontSize: isMobile ? "14px" : "16px", cursor: "pointer", background: eligibleYear === yr ? BLUE : "#fff", color: eligibleYear === yr ? "#fff" : BLUE, fontFamily: "inherit" }}>
            {yr}
          </button>
        ))}
      </div>

      {!is2029 && <PositionFilterBar options={allPositions} selected={selectedPositions} setSelected={setSelectedPositions} isMobile={isMobile} />}

      {is2029 ? (
        <div className="wdb-card" style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
          <div className="wdb-cardhead" style={{ background: BLUE, padding: "8px 16px" }}>
            <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>2029 Draft Class</div>
          </div>
          <div className="wdb-stripe" style={{ height: "3px", background: GOLD }} />
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
            <div style={{ marginBottom: "10px" }}>
              <div className="wd-mobile-filter-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "6px" }}>
                <DropdownChecklist title="School" options={allSchools} selected={selectedSchools} setSelected={setSelectedSchools} />
                <DropdownChecklist title="My Grade" options={gradeOrder} selected={selectedMyGrades} setSelected={setSelectedMyGrades} ordered />
                <Link to="/whiteboard" className="wdb-pill on" style={pillLink(true)}>Whiteboard ↗</Link>
                <Link to="/boards/feed" className="wdb-pill" style={pillLink(false)}>🔔 My Feed</Link>
              </div>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                {is2026 && (
                  <button onClick={() => setShowAvailableOnly((v) => !v)} className={"wdb-pill" + (showAvailableOnly ? " on" : "")}
                    style={{ ...pillLink(showAvailableOnly), padding: "8px 12px", fontSize: "12px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                    {showAvailableOnly ? "✓ Available" : "Available"}
                  </button>
                )}
                <input type="search" className="wdb-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search player..." aria-label="Search players"
                  style={{ flex: 1, minWidth: 0, border: "2px solid " + GOLD, borderRadius: "8px", padding: "8px 12px", fontWeight: 700, fontSize: "13px", color: BLUE, outline: "none" }} />
                <button onClick={resetFilters} style={{ background: "none", border: "none", color: "#999", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline", flexShrink: 0 }}>Reset</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", justifyContent: "center", marginBottom: "10px" }}>
              <DropdownChecklist title="School" options={allSchools} selected={selectedSchools} setSelected={setSelectedSchools} />
              <DropdownChecklist title="My Grade" options={gradeOrder} selected={selectedMyGrades} setSelected={setSelectedMyGrades} ordered />
              {is2026 && (
                <button onClick={() => setShowAvailableOnly((v) => !v)} className={"wdb-pill" + (showAvailableOnly ? " on" : "")}
                  style={{ ...pillLink(showAvailableOnly), cursor: "pointer", fontFamily: "inherit" }}>
                  {showAvailableOnly ? "✓ Available" : "Available"}
                </button>
              )}
              <input type="text" className="wdb-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search player..."
                style={{ border: "2px solid " + GOLD, borderRadius: "8px", padding: "8px 14px", fontWeight: 700, fontSize: "13px", color: BLUE, outline: "none", width: "220px" }} />
              <Link to="/community" className="wdb-pill" style={pillLink(false)}>+ Add Players</Link>
              <div style={{ position: "relative", display: "inline-block" }} onMouseEnter={() => setShowWhiteboardTip(true)} onMouseLeave={() => setShowWhiteboardTip(false)}>
                <Link to="/whiteboard" className="wdb-pill on" style={pillLink(true)}>Whiteboard ↗</Link>
                {showWhiteboardTip && (
                  <div style={{ position: "absolute", top: "calc(100% + 10px)", left: "50%", transform: "translateX(-50%)", width: "220px", background: "#fff", border: "1px solid #e3e8ef", borderRadius: "12px", padding: "10px 14px", boxShadow: "0 10px 30px rgba(15,27,45,0.12)", zIndex: 60, textAlign: "center", pointerEvents: "none" }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#444", lineHeight: 1.45, fontFamily: "Arial, sans-serif" }}>
                      Whiteboard is an easy way to rank players and customize your board.
                    </div>
                  </div>
                )}
              </div>
              <Link to="/boards/feed" className="wdb-pill" style={pillLink(false)}>🔔 My Feed</Link>
              <button onClick={resetFilters} style={{ background: "none", border: "none", color: "#999", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Reset</button>
            </div>
          )}

          <div className="wdb-card" style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
            <div className="wdb-cardhead" style={{ background: BLUE, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {selectedPositions.length > 0 ? `${eligibleYear} ${selectedPositions.join(" / ")}` : `${eligibleYear} Draft Class`}
              </div>
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px", fontWeight: 700 }}>
                {sortedPlayers.length} player{sortedPlayers.length !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="wdb-stripe" style={{ height: "3px", background: GOLD }} />

            {isMobile ? (
              <div style={{ maxHeight: "calc(70vh / var(--pz, 1))", overflowY: "auto" }}>
                {sortedPlayers.length === 0 ? (
                  <div style={{ padding: "28px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>{emptyText}</div>
                ) : sortedPlayers.map((p) => {
                  const myGrade = boardMap.get(p.id);
                  const draft = draftMap[p.Slug];
                  const teamData = draft ? nflTeams[draft.team] : null;
                  const c1 = teamData?.Color1 || BLUE;
                  const c2 = teamData?.Color2 || GOLD;
                  return (
                    <div key={p.id} className="wdb-row" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 8px 8px 10px", background: "#fff", borderBottom: "1px solid " + GOLD }}>
                      {is2026 && draft && (
                        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
                          <div style={{ width: 32, height: 32, borderRadius: "6px", background: c1, border: `2px solid ${c2}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ fontSize: "7px", fontWeight: 900, color: "rgba(255,255,255,0.7)", lineHeight: 1 }}>Rd {draft.round}</span>
                            <span style={{ fontSize: "13px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{draft.pick}</span>
                          </div>
                          {teamData?.Logo1 && <img src={sanitizeUrl(teamData.Logo1)} alt={draft.team} loading="lazy" style={{ width: "24px", height: "24px", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                          {showRanks && <RankChips classRank={ranks[p.id]?.classRank} positionRank={ranks[p.id]?.positionRank} position={p.Position} small />}
                          <Link to={`/player/${p.Slug}`} style={{ color: BLUE, fontWeight: 900, fontSize: "15px", textDecoration: "none", display: "block", lineHeight: 1.2, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {`${p.First || ""} ${p.Last || ""}`}
                          </Link>
                        </div>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "#555", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.Position || "—"} · {p.School || "—"}
                          {(p.HeightInches || p.Weight) && (
                            <span style={{ color: "#888" }}>
                              {" · "}{p.HeightInches ? formatHeight(p.HeightInches) : ""}{p.HeightInches && p.Weight ? ", " : ""}{p.Weight ? `${p.Weight} lbs` : ""}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
                        <div style={{ fontSize: "8px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>My</div>
                        <GradeBadge grade={myGrade} small />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
                        <div style={{ fontSize: "8px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>Comm</div>
                        <GradeBadge grade={displayCommGrade(commGrades[p.id])} small />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ maxHeight: "760px", overflowY: "auto" }}>
                <div className="wdb-colhead" style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center", gap: "16px", background: `linear-gradient(135deg, ${BLUE}, #003d7a)`, padding: "12px 20px" }}>
                  {is2026 && <SortLabel sortK="Pick" label="Pick" width="64px" />}
                  {is2026 && <div style={{ width: "56px", flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "14px" }}>
                    {showRanks && (
                      <div style={{ width: rankSlotWidth(RANK_CHIP.desktop) + "px", display: "flex", gap: RANK_CHIP.desktop.gap + "px", flexShrink: 0 }}>
                        <SortLabel sortK="ClassRank" label="CRK" title="Class Rank" width={RANK_CHIP.desktop.classW + "px"} />
                        <SortLabel sortK="PositionRank" label="PRK" title="Position Rank" width={RANK_CHIP.desktop.posW + "px"} />
                      </div>
                    )}
                    <SortLabel sortK="Position" label="Pos" title="Position" width={POS_COL_W + "px"} />
                    <div aria-hidden="true" style={{ width: LOGO_COL_W + "px", flexShrink: 0 }} />
                    <SortLabel sortK="Player" label="Player" align="left" />
                  </div>
                  <SortLabel sortK="MyGrade" label="My Grade" width="104px" />
                  <SortLabel sortK="CommunityGrade" label="Comm Grade" width="104px" />
                  <SortLabel sortK="Height" label="HT" width="60px" />
                  <SortLabel sortK="Weight" label="WT" width="60px" />
                </div>
                <div className="wdb-stripe" style={{ height: "3px", background: GOLD }} />

                {sortedPlayers.length === 0 ? (
                  <div style={{ padding: "32px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px", background: "#fff" }}>{emptyText}</div>
                ) : sortedPlayers.map((p) => {
                  const myGrade = boardMap.get(p.id);
                  const draft = draftMap[p.Slug];
                  const teamData = draft ? nflTeams[draft.team] : null;
                  const c1 = teamData?.Color1 || BLUE;
                  const c2 = teamData?.Color2 || GOLD;
                  const logo = logoBySchool[p.School];
                  return (
                    <div key={p.id} className="wdb-row"
                      style={{ display: "flex", alignItems: "center", gap: "16px", padding: "11px 20px", background: "#fff", borderBottom: "1px solid #eee", transition: "background 0.12s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f8ff"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}>
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
                            <img src={sanitizeUrl(teamData.Logo1)} alt={draft.team} title={teamData?.Name || draft.team} loading="lazy" style={{ width: "40px", height: "40px", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          ) : draft ? <span style={{ fontSize: "11px", fontWeight: 900, color: c1 }}>{draft.team}</span> : <span style={{ color: "#ddd" }}>—</span>}
                        </div>
                      )}

                      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "14px" }}>
                        {showRanks && <RankChips classRank={ranks[p.id]?.classRank} positionRank={ranks[p.id]?.positionRank} position={p.Position} />}
                        <div style={{ width: POS_COL_W + "px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                          {p.Position ? (
                            <span style={{ fontSize: "14px", fontWeight: 900, color: BLUE, background: "#eaf1ff", padding: "6px 0", width: "100%", textAlign: "center", borderRadius: "6px", textTransform: "uppercase" }}>{p.Position}</span>
                          ) : <span style={{ color: "#ddd" }}>—</span>}
                        </div>
                        <div style={{ width: LOGO_COL_W + "px", height: LOGO_COL_W + "px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {logo && (
                            <img src={sanitizeUrl(logo)} alt={p.School || ""} title={p.School || undefined} loading="lazy" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          )}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <Link to={`/player/${p.Slug}`}
                            style={{ color: BLUE, fontWeight: 900, fontSize: "28px", textDecoration: "none", display: "block", lineHeight: 1.1, overflowWrap: "break-word" }}
                            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}>
                            {`${p.First || ""} ${p.Last || ""}`}
                          </Link>
                        </div>
                      </div>

                      <div style={{ width: "104px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                        <GradeBadge grade={myGrade} />
                      </div>
                      <div style={{ width: "104px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                        <GradeBadge grade={displayCommGrade(commGrades[p.id])} />
                      </div>
                      <div style={{ width: "60px", flexShrink: 0, textAlign: "center", fontSize: "20px", fontWeight: 900, color: "#333" }}>
                        {p.HeightInches ? formatHeight(p.HeightInches) : (p.Height || "-")}
                      </div>
                      <div style={{ width: "60px", flexShrink: 0, textAlign: "center", fontSize: "20px", fontWeight: 900, color: "#333" }}>
                        {p.Weight || "-"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <Helmet><title>{boardsTitle} | We-Draft</title></Helmet>
      <style>{BOARD_MODERN_STYLE}</style>
      {isMobile && (
        <style>{`
          .wd-mobile-filter-grid > * { width: 100%; }
          .wd-mobile-filter-grid button, .wd-mobile-filter-grid a { width: 100%; box-sizing: border-box; text-align: center; }
        `}</style>
      )}
      {/* The Community Board's frame: ad rail, the board, then the right
          rail (Following Feed, Follow We-Draft); stacked on phones. */}
      {isMobile ? (
        <div ref={contentRef} className="wdb" style={{ padding: "4px 10px 60px", display: "flex", flexDirection: "column", gap: "24px" }}>
          <div style={{ maxWidth: "700px", margin: "0 auto", width: "100%" }}>{MainContent}</div>
          <div style={{ maxWidth: "700px", margin: "0 auto", width: "100%" }}><BoardsFeedCard /></div>
        </div>
      ) : (
        <div ref={contentRef} className="wdb" style={{ maxWidth: "1900px", margin: "0 auto", padding: "6px 24px 60px", display: "grid", gridTemplateColumns: "280px minmax(0, 1300px) 280px", gap: "20px", alignItems: "start" }}>
          <div style={{ position: "sticky", top: "20px" }}><SideRailAd isMobile={isMobile} /></div>
          <div>{MainContent}</div>
          <div style={{ position: "sticky", top: "20px", display: "flex", flexDirection: "column", gap: "18px" }}>
            <BoardsFeedCard />
            <BoardsFollowCard />
          </div>
        </div>
      )}
    </>
  );
}
