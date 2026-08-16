import React, { useEffect, useState, useRef } from "react";
import { collection, getDocs, doc, setDoc, serverTimestamp, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { Link, useNavigate, useParams } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";
import Logo2 from "../assets/Logo2.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const ARCHIVE_YEARS = ["2026"];
const ACTIVE_YEARS = ["2027", "2028", "2029"];

const SIDEBAR_NEWS_LIMIT = 8;
const SIDEBAR_VIDEO_LIMIT = 10;

const POSITION_LABELS = {
  QB: "Quarterback", RB: "Running Back", WR: "Wide Receiver", TE: "Tight End",
  OL: "Offensive Line", OT: "Offensive Tackle", OG: "Offensive Guard", C: "Center",
  EDGE: "Edge Rusher", DL: "Defensive Line", DT: "Defensive Tackle", DE: "Defensive End",
  LB: "Linebacker", DB: "Defensive Back", CB: "Cornerback", S: "Safety",
  K: "Kicker", P: "Punter", LS: "Long Snapper",
};

const gradeOrder = [
  "Watchlist",
  "Early First Round", "Middle First Round", "Late First Round",
  "Second Round", "Third Round", "Fourth Round",
  "Fifth Round", "Sixth Round", "Seventh Round", "UDFA",
];

const commGradeOrder = [
  "Early First Round", "Middle First Round", "Late First Round",
  "Second Round", "Third Round", "Fourth Round",
  "Fifth Round", "Sixth Round", "Seventh Round", "UDFA",
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

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

const toMs = (ts) => (ts && ts.toDate ? ts.toDate().getTime() : typeof ts === "number" ? ts : Date.parse(ts) || 0);

function formatRelativeTime(input) {
  if (!input) return "";
  const d = input && input.toDate ? input.toDate() : typeof input === "number" ? new Date(input) : new Date(input);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfToday - startOfDate) / 86400000);

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "This Week";
  if (diffDays <= 30) {
    const weeks = Math.max(1, Math.floor(diffDays / 7));
    return weeks === 1 ? "Last Week" : weeks + " Weeks Ago";
  }
  if (diffDays <= 60) return "Last Month";
  if (diffDays <= 365) {
    const months = Math.max(1, Math.floor(diffDays / 30));
    return months + " Month" + (months > 1 ? "s" : "") + " Ago";
  }
  return "Last Year";
}

const GradeBadge = ({ grade, small = false }) => {
  const w = small ? "48px" : "64px";
  const h = small ? "40px" : "52px";
  const numSz = small ? "14px" : "18px";
  const lblSz = small ? "5.5px" : "7px";
  const gd = gradeDisplay(grade);
  if (!gd) {
    return (
      <div style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: w, height: h, border: "2px solid #ddd", borderRadius: "5px",
        color: "#ccc", fontSize: small ? "14px" : "18px", fontWeight: 900,
      }}>—</div>
    );
  }
  const isFirstRound = ["Early First Round", "Middle First Round", "Late First Round"].includes(grade);
  const qualifier = isFirstRound ? grade.replace(" First Round", "").toUpperCase() : null;
  return (
    <div style={{
      display: "inline-flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", backgroundColor: gd.bg, border: "2px solid " + gd.border,
      borderRadius: "5px", width: w, height: h, flexShrink: 0, gap: "1px",
    }}>
      {qualifier && <span style={{ fontSize: small ? "6px" : "7.5px", fontWeight: 900, color: "rgba(255,255,255,0.9)", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1, textAlign: "center" }}>{qualifier}</span>}
      <span style={{ fontSize: numSz, fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.02em", textAlign: "center" }}>{gd.short}</span>
      <span style={{ fontSize: lblSz, fontWeight: 800, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center", lineHeight: 1.1 }}>{grade === "Watchlist" ? "LIST" : "ROUND"}</span>
    </div>
  );
};

const PlusBadge = ({ onClick, loading, small = false, user, login }) => {
  const w = small ? "48px" : "64px";
  const h = small ? "40px" : "52px";
  const [hovered, setHovered] = useState(false);

  const handleClick = () => {
    if (loading) return;
    if (!user) { login(); return; }
    onClick();
  };

  return (
    <div style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <div
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: w, height: h, border: "2px solid " + BLUE, borderRadius: "5px",
          cursor: loading ? "default" : "pointer",
          backgroundColor: hovered ? "#e6f0fa" : "#fff",
          color: BLUE, fontSize: small ? "18px" : "22px", fontWeight: 900,
          opacity: loading ? 0.4 : 1, transition: "background 0.15s",
        }}
      >
        +
      </div>
      {hovered && !loading && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#222",
          color: "#fff",
          fontSize: "11px",
          fontWeight: 800,
          padding: "4px 8px",
          borderRadius: "4px",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          zIndex: 999,
        }}>
          Add to Board
          <div style={{
            position: "absolute",
            top: "100%", left: "50%",
            transform: "translateX(-50%)",
            width: 0, height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: "5px solid #222",
          }} />
        </div>
      )}
    </div>
  );
};

const formatHeight = (inches) => {
  if (!inches) return "-";
  const ft = Math.floor(inches / 12);
  const inch = Math.round((inches % 12) * 10) / 10;
  return ft + "'" + inch + "\"";
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
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: "8px 16px", fontWeight: 900, fontSize: "13px",
          textTransform: "uppercase", letterSpacing: "0.05em",
          color: "#fff", background: BLUE, border: "2px solid " + GOLD,
          borderRadius: "8px", cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        {title}{selected.length > 0 ? " (" + selected.length + ")" : ""} ▾
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          zIndex: 50, width: "220px", maxHeight: "300px", overflowY: "auto",
          background: "#fff", border: "2px solid " + GOLD, borderRadius: "8px",
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
              border: "3px solid " + GOLD, borderRadius: "10px", cursor: "pointer",
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
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          border: "2px solid " + GOLD, borderRadius: "20px",
          padding: "6px 18px", fontWeight: 900, fontSize: "14px",
          cursor: "pointer",
          background: isArchive ? BLUE : "#fff",
          color: isArchive ? "#fff" : BLUE,
          display: "flex", alignItems: "center", gap: "6px",
          whiteSpace: "nowrap",
        }}
      >
        {isArchive ? ("Archive: " + eligibleYear) : "Archive"} ▾
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)",
          zIndex: 50, minWidth: "160px",
          background: "#fff", border: "2px solid " + GOLD, borderRadius: "10px",
          boxShadow: "0 6px 20px rgba(0,0,0,0.14)", overflow: "hidden",
        }}>
          <div style={{ background: BLUE, padding: "8px 14px", fontSize: "11px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Past Draft Classes
          </div>
          <div style={{ height: "3px", background: GOLD }} />
          {ARCHIVE_YEARS.map((yr) => (
            <div
              key={yr}
              onClick={() => { onSelect(yr); setOpen(false); }}
              style={{
                padding: "11px 16px", cursor: "pointer", fontWeight: 900,
                fontSize: "15px", color: eligibleYear === yr ? "#fff" : BLUE,
                background: eligibleYear === yr ? BLUE : "#fff",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                borderBottom: "1px solid #f0f0f0",
              }}
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

// ── Mobile-only "Draft Year" dropdown — the desktop header instead shows the
// full row of big year pills + the separate Archive dropdown; on mobile that
// row eats too much vertical space and wraps awkwardly, so this collapses
// all four years (2027/2028/2029 + the 2026 archive) into one compact
// button. Defaults to showing "2027" (the bare /community route) and
// navigates on selection, same as ArchiveDropdown above. ──
function YearDropdown({ eligibleYear, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const years = [...ACTIVE_YEARS, ...ARCHIVE_YEARS];

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const label = ARCHIVE_YEARS.includes(eligibleYear) ? (eligibleYear + " Archive") : eligibleYear;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "8px 16px", fontWeight: 900, fontSize: "13px",
          textTransform: "uppercase", letterSpacing: "0.05em",
          color: "#fff", background: BLUE, border: "2px solid " + GOLD,
          borderRadius: "8px", cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        Year: {label} ▾
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)",
          zIndex: 50, minWidth: "200px",
          background: "#fff", border: "2px solid " + GOLD, borderRadius: "10px",
          boxShadow: "0 6px 20px rgba(0,0,0,0.14)", overflow: "hidden",
        }}>
          <div style={{ background: BLUE, padding: "8px 14px", fontSize: "11px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Draft Year
          </div>
          <div style={{ height: "3px", background: GOLD }} />
          {years.map((yr) => {
            const isArchiveYr = ARCHIVE_YEARS.includes(yr);
            const active = eligibleYear === yr;
            return (
              <div
                key={yr}
                onClick={() => { onSelect(yr); setOpen(false); }}
                style={{
                  padding: "11px 16px", cursor: "pointer", fontWeight: 900,
                  fontSize: "15px", color: active ? "#fff" : BLUE,
                  background: active ? BLUE : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  borderBottom: "1px solid #f0f0f0",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#f0f5ff"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "#fff"; }}
              >
                <span>{isArchiveYr ? (yr + " Archive") : yr}</span>
                {active && <span style={{ color: GOLD }}>✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BoardDropdown({ dropdownRef, open, setOpen, isMobile, onNavigate, onMyBoards }) {
  return (
    <div ref={dropdownRef} style={{ position: "relative", display: "inline-block", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        style={{
          padding: isMobile ? "8px 14px" : "8px 16px",
          fontWeight: 900, fontSize: isMobile ? "12px" : "13px",
          textTransform: "uppercase", letterSpacing: "0.05em",
          border: "2px solid " + GOLD, borderRadius: "8px", cursor: "pointer",
          background: "#fff", color: BLUE, whiteSpace: "nowrap",
        }}
      >
        My Board ▾
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          zIndex: 50, minWidth: "180px",
          background: "#fff", border: "2px solid " + GOLD, borderRadius: "8px",
          boxShadow: "0 6px 16px rgba(0,0,0,0.12)", overflow: "hidden",
        }}>
          <div style={{ background: BLUE, padding: "8px 12px", fontSize: "12px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            My Board
          </div>
          <div style={{ height: "3px", background: GOLD }} />
          <div
            onClick={() => { setOpen(false); onMyBoards(); }}
            style={{
              padding: "11px 14px", cursor: "pointer", fontWeight: 800,
              fontSize: "14px", color: BLUE, background: "#fff",
              display: "flex", alignItems: "center", gap: "8px",
              borderBottom: "1px solid #eee",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
          >
            My Boards
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
            Open Whiteboard
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarCard({ title, color1, color2, children }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "2px solid " + color1 }}>
      <div style={{ backgroundColor: color1, padding: "12px 14px", textAlign: "center" }}>
        <div className="font-black uppercase" style={{ color: "#fff", fontSize: "20px", letterSpacing: "0.08em", textAlign: "center" }}>
          {title}
        </div>
      </div>
      <div style={{ height: "4px", backgroundColor: color2 }} />
      <div style={{ background: "#fff" }}>{children}</div>
    </div>
  );
}

export default function CommunityBoard() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const { year, position } = useParams();

  const eligibleYear = year || "2027";

  // ── yearPath is needed for the URL/canonical below, so it's defined up
  // here rather than further down with the rest of the nav helpers. ──
  const yearPath = (yr, pos) => {
    if (pos) return "/community/" + yr + "/" + pos.toLowerCase();
    return yr === "2027" ? "/community" : "/community/" + yr;
  };

  // ── SEO tags — computed from URL params alone (no fetched data), so they
  // can render on every pass, including the loading spinner. This is what
  // lets Prerender.io capture a valid <title>/description/canonical even if
  // it snapshots before the player list has loaded. ──
  const positionParam = position ? position.toUpperCase() : null;
  const positionLabel = positionParam ? (POSITION_LABELS[positionParam] || positionParam) : null;

  const pageTitle = positionLabel
    ? eligibleYear + " NFL Draft " + positionLabel + " Rankings | We-Draft.com"
    : eligibleYear + " NFL Draft Community Board | We-Draft.com";
  const pageDescription = positionLabel
    ? "We-Draft.com " + eligibleYear + " NFL Draft " + positionLabel + " rankings. Community grades, strengths, weaknesses, and NFL fit projections for top " + positionLabel.toLowerCase() + " prospects, voted on by the community."
    : "We-Draft.com " + eligibleYear + " NFL Draft community scouting board. Player grades, strengths, weaknesses, and NFL fit projections, voted on by the community.";
  const pageUrl = "https://we-draft.com" + yearPath(eligibleYear, positionParam);

  const SeoTags = (
    <Helmet>
      <title>{pageTitle}</title>
      <meta name="description" content={pageDescription} />
      <link rel="canonical" href={pageUrl} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={pageDescription} />
      <meta property="og:url" content={pageUrl} />
      <meta property="og:site_name" content="We-Draft.com" />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={pageDescription} />
    </Helmet>
  );

  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seoDataReady, setSeoDataReady] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [boardDropdownOpen, setBoardDropdownOpen] = useState(false);
  const boardDropdownRef = useRef(null);

  const [draftMap, setDraftMap] = useState({});
  const [nflTeams, setNflTeams] = useState({});

  const [sidebarNews, setSidebarNews] = useState([]);
  const [sidebarVideos, setSidebarVideos] = useState([]);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── Tells Prerender.io's headless browser when this page's data has
  // actually finished loading, instead of letting it guess via a fixed
  // timeout or the browser's `load` event. Same pattern as PlayerProfile.js
  // and TeamPage.js. ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.prerenderReady = false;
    const safetyTimer = setTimeout(() => { window.prerenderReady = true; }, 8000);
    return () => clearTimeout(safetyTimer);
  }, [eligibleYear, position]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (seoDataReady) window.prerenderReady = true;
  }, [seoDataReady]);

  useEffect(() => {
    const handler = (e) => {
      if (boardDropdownRef.current && !boardDropdownRef.current.contains(e.target)) {
        setBoardDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const [boardMap, setBoardMap] = useState(new Map());
  const [addingId, setAddingId] = useState(null);

  const [sortKey, setSortKey] = useState("CommunityGrade");
  const [sortOrder, setSortOrder] = useState("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSchools, setSelectedSchools] = useState([]);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [selectedCommGrades, setSelectedCommGrades] = useState([]);
  const [selectedMyGrades, setSelectedMyGrades] = useState([]);
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  // "View All" — non-live (admin-hidden) players are excluded by default;
  // this reveals them for the current view. Small/off-by-default on
  // purpose, since Live:false is a deliberate admin choice most visitors
  // shouldn't need to think about.
  const [showInactive, setShowInactive] = useState(false);

  const prevYearRef = useRef(eligibleYear);
  useEffect(() => {
    if (prevYearRef.current !== eligibleYear) {
      prevYearRef.current = eligibleYear;
      setSearchQuery("");
      setSelectedPositions([]);
      setSelectedSchools([]);
      setSelectedCommGrades([]);
      setSelectedMyGrades([]);
      setShowAvailableOnly(false);
      setShowInactive(false);
      setSortKey("CommunityGrade");
      setSortOrder("asc");
    }
  }, [eligibleYear]);

  const programmaticNavRef = useRef(false);

  useEffect(() => {
    if (programmaticNavRef.current) {
      programmaticNavRef.current = false;
      return;
    }
    const posUpper = position ? position.toUpperCase() : null;
    setSelectedPositions((prev) => {
      if (posUpper && prev.length === 1 && prev[0] === posUpper) return prev;
      if (!posUpper && prev.length === 0) return prev;
      return posUpper ? [posUpper] : [];
    });
  }, [position]);

  useEffect(() => {
    const currentPos = position ? position.toUpperCase() : null;
    const desiredPos = selectedPositions.length === 1 ? selectedPositions[0] : null;
    if (desiredPos === currentPos) return;
    programmaticNavRef.current = true;
    navigate(yearPath(eligibleYear, desiredPos), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPositions, eligibleYear]);

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

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const newsSnap = await getDocs(query(collection(db, "news"), where("active", "==", true)));
        const newsItems = newsSnap.docs.map((d) => ({ id: d.id, type: "news", ...d.data() }));

        let articleItems = [];
        try {
          const articleSnap = await getDocs(query(collection(db, "articles"), where("status", "==", "published")));
          articleItems = articleSnap.docs.map((d) => ({ id: d.id, type: "article", ...d.data() }));
        } catch (articleErr) {
          console.warn("Articles index missing, skipping:", articleErr);
        }

        const combined = [...articleItems, ...newsItems].sort(function (a, b) {
          return toMs(b.publishedAt) - toMs(a.publishedAt);
        });
        setSidebarNews(combined.slice(0, SIDEBAR_NEWS_LIMIT));
      } catch (e) {
        setSidebarNews([]);
      }
    };
    fetchNews();
  }, []);

  useEffect(() => {
    const fetchVideos = async () => {
      try {
        const snap = await getDocs(collection(db, "videos"));
        const vids = snap.docs
          .map(function (d) {
            const data = d.data();
            const items = Array.isArray(data.items) ? data.items : [];
            const first = items.length > 0 ? items[0] : null;
            return {
              id: d.id,
              video: data.Video || "",
              date: data.Date || null,
              title: data.GenTitle || (first && first.title) || "",
              thumb: data.GenThumb || (first && first.thumb) || "",
            };
          })
          .filter(function (v) { return !!v.video; })
          .sort(function (a, b) { return toMs(b.date) - toMs(a.date); })
          .slice(0, SIDEBAR_VIDEO_LIMIT);
        setSidebarVideos(vids);
      } catch (e) {
        setSidebarVideos([]);
      }
    };
    fetchVideos();
  }, []);

  const [playerCache, setPlayerCache] = useState({});

  // ── Two-phase fetch: (1) grab the base player list — names, schools,
  // positions, physicals — in a single query and render it immediately, so
  // `loading` clears and prerenderReady can fire on real, crawlable content
  // without waiting on anything else. (2) hydrate CommunityGrade in the
  // background via the per-player evaluations subcollection reads, which
  // are the slow part (N extra round-trips) but aren't needed for SEO or
  // for the page to be usable — they just fill in badges a beat later. ──
  useEffect(() => {
    setSeoDataReady(false);

    if (playerCache[eligibleYear]) {
      setPlayers(playerCache[eligibleYear]);
      setLoading(false);
      setSeoDataReady(true);
      return;
    }

    const isActiveYear = ACTIVE_YEARS.includes(eligibleYear);
    const isArchiveYear = ARCHIVE_YEARS.includes(eligibleYear);
    if (!isActiveYear && !isArchiveYear) {
      // No matching year — nothing to fetch, but loading must still clear
      // or this route hangs on the spinner forever.
      setLoading(false);
      setSeoDataReady(true);
      return;
    }

    let cancelled = false;

    const fetchPlayers = async () => {
      setLoading(true);
      try {
        // Non-live (Live === false, admin-hidden) players are no longer
        // dropped here — they're kept in `players` and filtered out later,
        // client-side, by the `showInactive` toggle below (see "View All").
        // The query itself was never scoped by Live anyway (there's no
        // where("Live", ...) clause), so keeping them costs nothing extra.
        const snap = await getDocs(query(collection(db, "players"), where("Eligible", "==", eligibleYear)));
        const basePlayers = snap.docs
          .map((docSnap) => {
            const p = { id: docSnap.id, ...docSnap.data() };
            const fortyKey = Object.keys(p).find((k) => k.replace(/\s/g, "") === "40Yard");
            if (fortyKey) p["40 Yard"] = p[fortyKey];
            if (p.Height) p.HeightInches = parseHeight(p.Height);
            p.CommunityGrade = "-"; // placeholder — hydrated below
            return p;
          });

        if (cancelled) return;

        // Phase 1 done — render immediately, clear the spinner, let
        // prerenderReady fire. Grades aren't in yet, but every player's
        // name/school/position is, which is what actually needs indexing.
        setPlayers(basePlayers);
        setLoading(false);
        setSeoDataReady(true);

        // Phase 2 — fill in community grades in the background.
        const withGrades = await Promise.all(
          basePlayers.map(async (p) => {
            try {
              const evalsSnap = await getDocs(collection(db, "players", p.id, "evaluations"));
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

        if (cancelled) return;
        setPlayers(withGrades);
        setPlayerCache((prev) => ({ ...prev, [eligibleYear]: withGrades }));
      } catch (err) {
        console.error("Error fetching players:", err);
        if (!cancelled) {
          setLoading(false);
          setSeoDataReady(true);
        }
      }
    };
    fetchPlayers();

    return () => { cancelled = true; };
  }, [eligibleYear]);

  useEffect(() => {
    const fetchBoard = async () => {
      if (!user || !user.uid) { setBoardMap(new Map()); return; }
      try {
        const snap = await getDocs(collection(db, "users", user.uid, "evaluations"));
        const m = new Map();
        snap.docs.forEach((d) => m.set(d.id, d.data().grade || "Watchlist"));
        setBoardMap(m);
      } catch (err) { console.error("Error fetching board:", err); }
    };
    fetchBoard();
  }, [user]);

  const handleAddToBoard = async (p) => {
    if (!user) { login(); return; }
    if (boardMap.has(p.id)) return;
    setAddingId(p.id);
    try {
      const evalData = {
        uid: user.uid, email: user.email,
        playerId: p.id,
        playerName: (p.First || "") + " " + (p.Last || ""),
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

  const resetFilters = () => {
    setSelectedSchools([]); setSelectedPositions([]);
    setSelectedCommGrades([]); setSelectedMyGrades([]);
    setSearchQuery(""); setShowAvailableOnly(false); setShowInactive(false);
    setSortKey("CommunityGrade"); setSortOrder("asc");
  };

  const is2026 = eligibleYear === "2026";
  const is2029Empty = eligibleYear === "2029" && !loading && players.length === 0;

  // Every filter except the live/inactive one, applied first — this is what
  // "View All" needs to count against (how many *additional* players, given
  // whatever else is currently filtered, are only hidden because they're
  // non-live), not the raw unfiltered player count.
  const visibleFilteredPlayers = players
    .filter((p) => !searchQuery.trim() ? true : ((p.First || "") + " " + (p.Last || "")).toLowerCase().includes(searchQuery.trim().toLowerCase()))
    .filter((p) => selectedPositions.length === 0 ? true : selectedPositions.includes(p.Position))
    .filter((p) => selectedSchools.length === 0 ? true : selectedSchools.includes(p.School))
    .filter((p) => selectedCommGrades.length === 0 ? true : selectedCommGrades.includes(p.CommunityGrade))
    .filter((p) => {
      if (selectedMyGrades.length === 0) return true;
      const myGrade = boardMap.get(p.id);
      return myGrade ? selectedMyGrades.includes(myGrade) : false;
    })
    .filter((p) => showAvailableOnly ? !draftMap[p.Slug] : true);

  const inactiveHiddenCount = visibleFilteredPlayers.filter((p) => p.Live === false).length;
  const filteredPlayers = visibleFilteredPlayers.filter((p) => showInactive ? true : p.Live !== false);

  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    if (sortKey === "CommunityGrade") {
      const aV = gradeScale[a.CommunityGrade];
      const bV = gradeScale[b.CommunityGrade];
      if (aV && bV) return sortOrder === "asc" ? aV - bV : bV - aV;
      if (aV && !bV) return sortOrder === "asc" ? -1 : 1;
      if (!aV && bV) return sortOrder === "asc" ? 1 : -1;
      return (a.Last || "").localeCompare(b.Last || "");
    }
    if (sortKey === "MyGrade") {
      const myGradeOrder = {
        "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
        "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
        "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9,
        "UDFA": 10, "Watchlist": 11,
      };
      const aG = boardMap.get(a.id), bG = boardMap.get(b.id);
      const aV = aG !== undefined ? (myGradeOrder[aG] || 99) : 999;
      const bV = bG !== undefined ? (myGradeOrder[bG] || 99) : 999;
      return sortOrder === "asc" ? aV - bV : bV - aV;
    }
    if (sortKey === "Pick") {
      const aD = draftMap[a.Slug], bD = draftMap[b.Slug];
      return sortOrder === "asc" ? ((aD && aD.pick) || 9999) - ((bD && bD.pick) || 9999) : ((bD && bD.pick) || 9999) - ((aD && aD.pick) || 9999);
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

  if (loading) {
    return (
      <>
        {SeoTags}
        <LoadingSpinner label="Loading Board" size={64} minHeight="100vh" />
      </>
    );
  }

  const NewsSidebar = (
    <SidebarCard title="In The News" color1={BLUE} color2={GOLD}>
      {sidebarNews.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>No recent news.</div>
      ) : (
        sidebarNews.map((n, i) => (
          <Link key={n.slug || n.id} to={"/news/" + n.slug}
            style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", textDecoration: "none", borderBottom: i < sidebarNews.length - 1 ? "1px solid #f0f0f0" : "none" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f7f9fc"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
          >
            <div className="flex-shrink-0 rounded overflow-hidden" style={{ width: 36, border: "2px solid " + BLUE, background: "#fff", display: "flex", flexDirection: "column" }}>
              <div style={{ background: GOLD, lineHeight: 1, padding: "1px 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "8px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  {n.publishedAt && n.publishedAt.toDate ? n.publishedAt.toDate().toLocaleDateString(undefined, { month: "short" }) : ""}
                </span>
              </div>
              <div style={{ padding: "3px 0 2px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "15px", fontWeight: 900, color: BLUE, lineHeight: 1 }}>
                  {n.publishedAt && n.publishedAt.toDate ? n.publishedAt.toDate().toLocaleDateString(undefined, { day: "numeric" }) : ""}
                </span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="font-black uppercase leading-tight" style={{ color: "#222", letterSpacing: "0.03em", fontSize: "12px" }}>{n.title}</div>
            </div>
          </Link>
        ))
      )}
    </SidebarCard>
  );

  const VideosSidebar = (
    <SidebarCard title="Videos" color1={BLUE} color2={GOLD}>
      {sidebarVideos.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>No videos yet.</div>
      ) : (
        sidebarVideos.map((v, i) => {
          const relTime = formatRelativeTime(v.date);
          return (
            <a
              key={v.id}
              href={sanitizeUrl(v.video)}
              target="_blank"
              rel="noopener noreferrer"
              className="wd-video-card"
              style={{
                display: "block",
                position: "relative",
                textDecoration: "none",
                borderBottom: i < sidebarVideos.length - 1 ? "1px solid #f0f0f0" : "none",
              }}
            >
              <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#111", overflow: "hidden" }}>
                {v.thumb ? (
                  <img
                    className="wd-video-thumb"
                    src={sanitizeUrl(v.thumb)}
                    alt={v.title || "Video thumbnail"}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.4s ease" }}
                    referrerPolicy="no-referrer"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                    loading="lazy"
                  />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ color: "#fff", fontSize: "32px" }}>▶</span>
                  </div>
                )}

                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.15) 55%, transparent 100%)", pointerEvents: "none" }} />

                <div
                  className="wd-video-play"
                  style={{
                    position: "absolute", top: "50%", left: "50%",
                    transform: "translate(-50%, -50%) scale(0.8)",
                    width: "48px", height: "48px", borderRadius: "50%",
                    background: "rgba(255,255,255,0.95)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: 0, transition: "opacity 0.25s ease, transform 0.25s ease",
                    boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
                  }}
                >
                  <span style={{ color: BLUE, fontSize: "18px", marginLeft: "3px" }}>▶</span>
                </div>

                {relTime && (
                  <div style={{ position: "absolute", top: "8px", right: "8px" }}>
                    <span style={{ background: "rgba(0,0,0,0.65)", color: "#fff", fontSize: "9px", fontWeight: 900, padding: "3px 8px", borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {relTime}
                    </span>
                  </div>
                )}

                {v.title && (
                  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 12px" }}>
                    <div className="font-black uppercase leading-tight" style={{ color: "#fff", fontSize: "13px", letterSpacing: "0.03em", textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}>
                      {v.title}
                    </div>
                  </div>
                )}
              </div>
            </a>
          );
        })
      )}
    </SidebarCard>
  );

  const MainContent = (
    <div style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
      <div style={{ marginBottom: "20px", border: "3px solid " + BLUE, borderRadius: "12px", overflow: "hidden" }}>
        <div style={{
          background: BLUE, padding: isMobile ? "18px 14px" : "24px 20px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
        }}>
          <img src={Logo2} alt="We-Draft.com" style={{ height: isMobile ? "36px" : "48px", objectFit: "contain" }} />
          <h1 style={{
            fontSize: isMobile ? "34px" : "56px", fontWeight: 900, textTransform: "uppercase",
            letterSpacing: "0.04em", color: "#fff", lineHeight: 1, textAlign: "center", width: "100%",
            margin: 0,
            minHeight: isMobile ? "72px" : "120px",
            display: "flex", alignItems: "center", justifyContent: "center",
            textShadow: "-1px -1px 0 " + GOLD + ", 1px -1px 0 " + GOLD + ", -1px 1px 0 " + GOLD + ", 1px 1px 0 " + GOLD + ", 0 -1px 0 " + GOLD + ", 0 1px 0 " + GOLD + ", -1px 0 0 " + GOLD + ", 1px 0 0 " + GOLD,
          }}>
            {positionLabel ? (eligibleYear + " " + positionLabel + " Rankings") : (eligibleYear + " Community Board")}
          </h1>
          <div style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 700, color: "rgba(255,255,255,0.75)", letterSpacing: "0.06em", textTransform: "uppercase", textAlign: "center", lineHeight: 1.4, minHeight: isMobile ? "34px" : "20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {positionLabel ? (eligibleYear + " NFL Draft " + positionLabel + " Board — We-Draft.com User Grades") : (eligibleYear + " NFL Draft Community Board — We-Draft.com User Grades")}
          </div>
        </div>
        <div style={{ height: "4px", background: GOLD }} />
      </div>

      {/* Draft Year — mobile collapses the whole row (3 big pills + a
          separate Archive dropdown) into one compact dropdown, since that
          row wraps to multiple lines and eats a lot of vertical space on a
          narrow screen. Desktop keeps the big pill row unchanged. */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
        {isMobile ? (
          <YearDropdown eligibleYear={eligibleYear} onSelect={(yr) => navigate(yearPath(yr))} />
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
            <ArchiveDropdown eligibleYear={eligibleYear} onSelect={(yr) => navigate(yearPath(yr))} />
            {ACTIVE_YEARS.map((yr) => (
              <Link
                key={yr}
                to={yearPath(yr)}
                style={{
                  border: "3px solid " + GOLD, borderRadius: "24px",
                  padding: "14px 40px",
                  fontWeight: 900, fontSize: "22px",
                  background: eligibleYear === yr ? BLUE : "#fff",
                  color: eligibleYear === yr ? "#fff" : BLUE,
                  transition: "background 0.15s, color 0.15s",
                  textDecoration: "none", display: "inline-block",
                }}
              >
                {yr}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Desktop-only Position chip row — on mobile, Position joins the rest
          of the filter buttons in the single grid below instead of getting
          its own separate centered row (that, plus the old 3-item/2-column
          grid leaving Comm Grade dangling alone next to an empty cell, plus
          a mixed dropdown/toggle/search-input/text-link row underneath, was
          the "all over the place" mobile layout being fixed here). */}
      {!is2029Empty && !isMobile && (
        <PositionFilterBar options={allPositions} selected={selectedPositions} setSelected={setSelectedPositions} />
      )}

      {is2029Empty ? (
        <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
          <div style={{ background: BLUE, padding: "8px 16px" }}>
            <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>2029 Draft Class</div>
          </div>
          <div style={{ height: "3px", background: GOLD }} />
          <div style={{ padding: isMobile ? "40px 20px" : "60px 40px", textAlign: "center", background: "#fff" }}>
            <div style={{ fontSize: "40px", marginBottom: "16px" }}>🏈</div>
            <div style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
              2029 Players Coming Soon
            </div>
            <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: "#888", maxWidth: "480px", margin: "0 auto", lineHeight: 1.6 }}>
              The 2029 draft class will be added once the 2026 college football season kicks off. Check back then to start evaluating the next wave of prospects.
            </div>
          </div>
        </div>
      ) : (
        <>
          {isMobile ? (
            <div style={{ marginBottom: "12px" }}>
              {/* One consistent 2-column grid for every filter button —
                  Position, School, My Grade, Comm Grade, Board, and (2026
                  only) Available — instead of splitting them across a
                  lopsided 3-item grid and a separate mixed row of
                  dropdown/toggle/search-input/text-link that wrapped
                  unpredictably. Search and Reset get their own clean rows
                  below since a growing text input doesn't belong in a
                  fixed-column button grid. */}
              <div className="wd-mobile-filter-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
                <DropdownChecklist title="Position" options={allPositions} selected={selectedPositions} setSelected={setSelectedPositions} />
                <DropdownChecklist title="School" options={allSchools} selected={selectedSchools} setSelected={setSelectedSchools} />
                <DropdownChecklist title="My Grade" options={gradeOrder} selected={selectedMyGrades} setSelected={setSelectedMyGrades} ordered />
                <DropdownChecklist title="Comm Grade" options={commGradeOrder} selected={selectedCommGrades} setSelected={setSelectedCommGrades} ordered />
                <BoardDropdown
                  dropdownRef={boardDropdownRef}
                  open={boardDropdownOpen}
                  setOpen={setBoardDropdownOpen}
                  isMobile={isMobile}
                  onNavigate={() => navigate("/whiteboard")}
                  onMyBoards={() => navigate("/boards")}
                />
                {is2026 && (
                  <button
                    onClick={() => setShowAvailableOnly((v) => !v)}
                    style={{
                      padding: "8px 16px", fontWeight: 900, fontSize: "13px",
                      textTransform: "uppercase", letterSpacing: "0.05em",
                      border: "2px solid " + GOLD, borderRadius: "8px", cursor: "pointer",
                      background: showAvailableOnly ? GOLD : "#fff",
                      color: showAvailableOnly ? "#fff" : BLUE, whiteSpace: "nowrap",
                    }}
                  >
                    {showAvailableOnly ? "✓ Available" : "Available"}
                  </button>
                )}
              </div>
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search player..."
                style={{ display: "block", width: "100%", boxSizing: "border-box", border: "2px solid " + GOLD, borderRadius: "8px", padding: "10px 14px", fontWeight: 700, fontSize: "14px", color: BLUE, outline: "none", marginBottom: "6px" }} />
              <div style={{ textAlign: "center" }}>
                <button onClick={resetFilters} style={{ background: "none", border: "none", color: "#999", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Reset Filters</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", justifyContent: "center", marginBottom: "10px" }}>
              <DropdownChecklist title="School" options={allSchools} selected={selectedSchools} setSelected={setSelectedSchools} />
              <DropdownChecklist title="My Grade" options={gradeOrder} selected={selectedMyGrades} setSelected={setSelectedMyGrades} ordered />
              <DropdownChecklist title="Comm Grade" options={commGradeOrder} selected={selectedCommGrades} setSelected={setSelectedCommGrades} ordered />
              <BoardDropdown
                dropdownRef={boardDropdownRef}
                open={boardDropdownOpen}
                setOpen={setBoardDropdownOpen}
                isMobile={isMobile}
                onNavigate={() => navigate("/whiteboard")}
                onMyBoards={() => navigate("/boards")}
              />
              {is2026 && (
                <button
                  onClick={() => setShowAvailableOnly((v) => !v)}
                  style={{
                    padding: "8px 16px", fontWeight: 900, fontSize: "13px",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                    border: "2px solid " + GOLD, borderRadius: "8px", cursor: "pointer",
                    background: showAvailableOnly ? GOLD : "#fff",
                    color: showAvailableOnly ? "#fff" : BLUE, whiteSpace: "nowrap",
                  }}
                >
                  {showAvailableOnly ? "✓ Available" : "Available"}
                </button>
              )}
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search player..."
                style={{ border: "2px solid " + GOLD, borderRadius: "8px", padding: "8px 14px", fontWeight: 700, fontSize: "13px", color: BLUE, outline: "none", width: "280px" }} />
              <button onClick={resetFilters} style={{ background: "none", border: "none", color: "#999", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Reset</button>
            </div>
          )}

          <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ background: BLUE, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {selectedPositions.length === 1
                  ? (eligibleYear + " " + (POSITION_LABELS[selectedPositions[0]] || selectedPositions[0]) + " Rankings")
                  : (eligibleYear + " Draft Class")}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px", fontWeight: 700 }}>
                  {sortedPlayers.length} player{sortedPlayers.length !== 1 ? "s" : ""}
                </div>
                {/* "View All" — small and easy to miss on purpose, since
                    non-live players are hidden by an admin's own deliberate
                    choice; this is an opt-in escape hatch, not something
                    most visitors need front-and-center. Only shows up at all
                    when there's actually something it would add. */}
                {(inactiveHiddenCount > 0 || showInactive) && (
                  <button
                    onClick={() => setShowInactive((v) => !v)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: showInactive ? GOLD : "rgba(255,255,255,0.55)",
                      fontSize: "10px", fontWeight: 800, textTransform: "uppercase",
                      letterSpacing: "0.05em", textDecoration: "underline", padding: 0,
                    }}
                  >
                    {showInactive ? "Hide Inactive" : "View All" + (inactiveHiddenCount > 0 ? " (+" + inactiveHiddenCount + ")" : "")}
                  </button>
                )}
              </div>
            </div>
            <div style={{ height: "3px", background: GOLD }} />

            {isMobile ? (
              <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
                {sortedPlayers.length === 0 ? (
                  <div style={{ padding: "28px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>
                    No players match your filters.
                  </div>
                ) : sortedPlayers.map((p) => {
                  const myGrade = boardMap.get(p.id);
                  const onBoard = myGrade !== undefined;
                  const isAdding = addingId === p.id;
                  const draft = draftMap[p.Slug];
                  const teamData = draft ? nflTeams[draft.team] : null;
                  const c1 = (teamData && teamData.Color1) || BLUE;
                  const c2 = (teamData && teamData.Color2) || GOLD;
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: "#fff", borderBottom: "1px solid " + GOLD }}>
                      {is2026 && draft && (
                        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
                          <div style={{ width: 32, height: 32, borderRadius: "6px", background: c1, border: "2px solid " + c2, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ fontSize: "7px", fontWeight: 900, color: "rgba(255,255,255,0.7)", lineHeight: 1 }}>Rd {draft.round}</span>
                            <span style={{ fontSize: "13px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{draft.pick}</span>
                          </div>
                          {teamData && teamData.Logo1 ? (
                            <img src={sanitizeUrl(teamData.Logo1)} alt={draft.team} loading="lazy" style={{ width: "24px", height: "24px", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          ) : (
                            <span style={{ fontSize: "8px", fontWeight: 900, color: c1 }}>{draft.team}</span>
                          )}
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Link
                          to={"/player/" + p.Slug}
                          style={{ color: BLUE, fontWeight: 900, fontSize: "15px", textDecoration: "none", display: "block", lineHeight: 1.2 }}
                          onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                        >
                          {(p.First || "") + " " + (p.Last || "")}
                        </Link>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "#555", marginTop: "3px" }}>
                          {p.Position || "—"} · {p.School || "—"}
                        </div>
                        {(p.HeightInches || p.Weight) && (
                          <div style={{ fontSize: "11px", color: "#aaa", fontWeight: 700, marginTop: "2px" }}>
                            {p.HeightInches ? formatHeight(p.HeightInches) : ""}{p.HeightInches && p.Weight ? " · " : ""}{p.Weight ? (p.Weight + " lbs") : ""}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
                        <div style={{ fontSize: "8px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>My</div>
                        {isAdding ? (
                          <div style={{ width: "48px", height: "40px", border: "2px solid " + BLUE, borderRadius: "5px", opacity: 0.4 }} />
                        ) : onBoard ? (
                          <GradeBadge grade={myGrade} small />
                        ) : (
                          <PlusBadge onClick={() => handleAddToBoard(p)} loading={isAdding} small user={user} login={login} />
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
              <div style={{ maxHeight: "760px", overflowY: "auto" }}>
                {(() => {
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
                  return (
                    <div style={{
                      position: "sticky", top: 0, zIndex: 10,
                      display: "flex", alignItems: "center", gap: "16px",
                      background: "linear-gradient(135deg, " + BLUE + ", #003d7a)",
                      padding: "12px 20px",
                    }}>
                      {is2026 && <SortLabel sortK="Pick" label="Pick" width="64px" />}
                      {is2026 && <div style={{ width: "56px", flexShrink: 0 }} />}
                      <SortLabel sortK="Player" label="Player" align="left" />
                      <SortLabel sortK="Position" label="Pos" width="84px" />
                      <SortLabel sortK="MyGrade" label="My Grade" width="140px" />
                      <SortLabel sortK="CommunityGrade" label="Comm Grade" width="140px" />
                      <SortLabel sortK="Height" label="HT" width="70px" />
                      <SortLabel sortK="Weight" label="WT" width="70px" />
                    </div>
                  );
                })()}
                <div style={{ height: "3px", background: GOLD }} />

                {sortedPlayers.length === 0 ? (
                  <div style={{ padding: "32px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px", background: "#fff" }}>
                    No players match your filters.
                  </div>
                ) : sortedPlayers.map((p) => {
                  const myGrade = boardMap.get(p.id);
                  const onBoard = myGrade !== undefined;
                  const isAdding = addingId === p.id;
                  const draft = draftMap[p.Slug];
                  const teamData = draft ? nflTeams[draft.team] : null;
                  const c1 = (teamData && teamData.Color1) || BLUE;
                  const c2 = (teamData && teamData.Color2) || GOLD;
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
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "48px", height: "48px", borderRadius: "7px", background: c1, border: "2px solid " + c2 }}>
                              <span style={{ fontSize: "8px", fontWeight: 900, color: "rgba(255,255,255,0.7)", lineHeight: 1, textTransform: "uppercase" }}>Rd {draft.round}</span>
                              <span style={{ fontSize: "19px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{draft.pick}</span>
                            </div>
                          ) : <span style={{ color: "#ddd" }}>—</span>}
                        </div>
                      )}
                      {is2026 && (
                        <div style={{ width: "56px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                          {teamData && teamData.Logo1 ? (
                            <img src={sanitizeUrl(teamData.Logo1)} alt={draft.team} title={(teamData && teamData.Name) || draft.team} loading="lazy" style={{ width: "40px", height: "40px", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          ) : draft ? <span style={{ fontSize: "11px", fontWeight: 900, color: c1 }}>{draft.team}</span> : <span style={{ color: "#ddd" }}>—</span>}
                        </div>
                      )}

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Link
                          to={"/player/" + p.Slug}
                          style={{ color: BLUE, fontWeight: 900, fontSize: "27px", textDecoration: "none", display: "block", lineHeight: 1.15 }}
                          onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                        >
                          {(p.First || "") + " " + (p.Last || "")}
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
                          <div style={{ width: "64px", height: "52px", border: "2px solid " + BLUE, borderRadius: "5px", opacity: 0.4 }} />
                        ) : onBoard ? (
                          <GradeBadge grade={myGrade} />
                        ) : (
                          <PlusBadge onClick={() => handleAddToBoard(p)} loading={isAdding} user={user} login={login} />
                        )}
                      </div>

                      <div style={{ width: "140px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                        <GradeBadge grade={p.CommunityGrade} />
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
            <p style={{ textAlign: "center", marginTop: "14px", fontSize: "13px", color: "#999", fontWeight: 700 }}>
              <span onClick={login} style={{ color: BLUE, fontWeight: 900, cursor: "pointer", textDecoration: "underline" }}>Sign in</span> to add players to your board
            </p>
          )}
        </>
      )}
    </div>
  );

  return (
    <>
      {SeoTags}

      {/* Mobile filter grid — every button (Position/School/My Grade/Comm
          Grade/Board/Available) is a different shared component with its
          own naturally content-sized <button>, so left to themselves they
          render at whatever width their own label needs, producing a
          ragged, misaligned block instead of a clean grid. This stretches
          each one to fill its grid cell and centers its label, so the
          buttons actually line up into even columns instead of "all over
          the place." Scoped to .wd-mobile-filter-grid — doesn't touch the
          same components' desktop appearance. */}
      {isMobile && (
        <style>{`
          .wd-mobile-filter-grid button { width: 100%; box-sizing: border-box; text-align: center; }
          /* When the grid has an odd number of buttons (e.g. no Available
             toggle outside the 2026 archive), the trailing one lands alone
             in the left column with an empty gap beside it — span it across
             both columns instead so it doesn't look orphaned. :last-child +
             :nth-child(odd) only matches when the total count is odd. */
          .wd-mobile-filter-grid > *:last-child:nth-child(odd) { grid-column: 1 / -1; }
        `}</style>
      )}

      {sidebarVideos.length > 0 && (
        <style>{".wd-video-card:hover .wd-video-thumb { transform: scale(1.08); } .wd-video-card:hover .wd-video-play { opacity: 1; transform: translate(-50%, -50%) scale(1); }"}</style>
      )}

      {isMobile ? (
        <div style={{ padding: "4px 10px 60px", display: "flex", flexDirection: "column", gap: "24px" }}>
          <div style={{ maxWidth: "700px", margin: "0 auto", width: "100%" }}>{MainContent}</div>
          {sidebarNews.length > 0 && <div style={{ maxWidth: "700px", margin: "0 auto", width: "100%" }}>{NewsSidebar}</div>}
          {sidebarVideos.length > 0 && <div style={{ maxWidth: "700px", margin: "0 auto", width: "100%" }}>{VideosSidebar}</div>}
        </div>
      ) : (
        <div style={{ maxWidth: "1900px", margin: "0 auto", padding: "6px 24px 60px", display: "grid", gridTemplateColumns: "280px minmax(0, 1300px) 280px", gap: "20px", alignItems: "start" }}>
          <div style={{ position: "sticky", top: "20px" }}>{NewsSidebar}</div>
          <div>{MainContent}</div>
          <div style={{ position: "sticky", top: "20px" }}>{VideosSidebar}</div>
        </div>
      )}
    </>
  );
}