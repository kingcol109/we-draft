import React, { useEffect, useState, useRef } from "react";
import { collection, getDocs, doc, setDoc, serverTimestamp, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { averageGradesFor, gradeLabel } from "../utils/communityGrades";
import { Link, useNavigate, useParams } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";
import { useMobileStuckPageWatchdog } from "../hooks/useMobileStuckPageWatchdog";
import { canonicalEvalData } from "../utils/evaluationCopies";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { classSnapshotRanks, compareRanks } from "../utils/classRanks";
import { SideRailAd } from "../components/MarginAds";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const ARCHIVE_YEARS = ["2026"];
const ACTIVE_YEARS = ["2027", "2028", "2029"];

const SIDEBAR_NEWS_LIMIT = 8;
const SIDEBAR_VIDEO_LIMIT = 10;

// Board position → its CFB stat table (/cfb/stats/:group).
const STATS_GROUP = { QB: "passing", RB: "rushing", WR: "receiving", TE: "receiving", EDGE: "defense", DL: "defense", DT: "defense", DE: "defense", LB: "defense", DB: "defense", CB: "defense", S: "defense" };

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

// ── Modern look — the player page's design language (PlayerProfile.js's
// MODERN_STYLE): light page, 1px hairlines instead of 2–3px blue/gold
// borders, one radius scale (10 / 14 / pill), compact left-anchored blue
// headers, outline-by-default pills (filled only when active), no gold
// stripes, no sub-10px text. Scoped under .wdb and layered over the
// existing inline styles (hence !important); ?modern=0 shows the old look. ──
const BOARD_MODERN_STYLE = `
  .wdb {
    --ink: #0f1b2d; --ink-2: #33415a; --ink-3: #5b6b84; --ink-4: #8a97ab;
    --line: #e3e8ef; --line-2: #eef1f5; --soft: #f7f9fc;
  }
  body:has(.wdb) { background: #f4f6f9; }
  .wdb .wdb-stripe { display: none !important; }
  .wdb .wdb-hero { border: 1px solid var(--line) !important; border-radius: 16px !important; }

  /* pills & buttons: outlined by default, filled blue only when active */
  .wdb .wdb-pill {
    border: 1px solid var(--line) !important; border-radius: 999px !important;
    background: #fff !important; color: ${BLUE} !important; font-weight: 800 !important;
    transition: background 0.15s, border-color 0.15s, color 0.15s !important;
  }
  .wdb .wdb-pill:hover { border-color: ${BLUE} !important; }
  .wdb .wdb-pill.on { background: ${BLUE} !important; border-color: ${BLUE} !important; color: #fff !important; }
  /* class (year) + position pills: gold when selected */
  .wdb .wdb-pill.wdb-sel.on { background: ${GOLD} !important; border-color: ${GOLD} !important; color: #fff !important; }
  .wdb .wdb-pill.wdb-sel:hover { border-color: ${GOLD} !important; }
  .wdb .wdb-sidehead-link:hover { text-decoration-color: #fff !important; }
  .wdb .wdb-menu { border: 1px solid var(--line) !important; border-radius: 12px !important; box-shadow: 0 10px 30px rgba(15, 27, 45, 0.12) !important; }
  .wdb .wdb-menu > div:first-child, .wdb .wdb-menu > div:first-child span { color: #fff !important; font-size: 12px !important; letter-spacing: 0.14em !important; }
  .wdb .wdb-input { border: 1px solid #d5dce6 !important; border-radius: 10px !important; font-weight: 600 !important; color: var(--ink) !important; background: #fff; }
  .wdb .wdb-input:focus { outline: none; border-color: ${BLUE} !important; box-shadow: 0 0 0 3px rgba(0, 85, 165, 0.15); }

  /* rankings card */
  .wdb .wdb-card { border: 1px solid var(--line) !important; border-radius: 14px !important; background: #fff; }
  .wdb .wdb-cardhead { padding: 10px 16px !important; }
  .wdb .wdb-cardhead > div:first-child { color: #fff !important; font-size: 14px !important; letter-spacing: 0.08em !important; }
  .wdb .wdb-colhead { background: var(--soft) !important; border-bottom: 1px solid var(--line) !important; padding: 10px 20px !important; }
  .wdb .wdb-colhead button { color: var(--ink-3) !important; opacity: 1 !important; font-size: 12px !important; letter-spacing: 0.12em !important; }
  .wdb .wdb-colhead button[aria-pressed="true"] { color: ${GOLD} !important; }
  .wdb .wdb-row { border-bottom: 1px solid var(--line-2) !important; }
  .wdb .wdb-grade { border: 0 !important; border-radius: 10px !important; }
  .wdb .wdb-plus { border: 1px solid var(--line) !important; border-radius: 10px !important; }
  .wdb .wdb-plus:hover, .wdb .wdb-plus:focus-visible { border-color: ${BLUE} !important; }

  /* sidebars: site-blue header, compact and left-anchored */
  .wdb .wdb-side { border: 1px solid var(--line) !important; border-radius: 14px !important; background: #fff; }
  .wdb .wdb-sidehead { padding: 12px 16px !important; text-align: left !important; }
  .wdb .wdb-sidehead > div { font-size: 13px !important; letter-spacing: 0.14em !important; text-align: left !important; }
  .wdb .wdb-date { border: 1px solid var(--line) !important; border-radius: 8px !important; }
  .wdb .wdb-date > div:first-child { background: var(--soft) !important; padding: 2px 0 !important; }
  .wdb .wdb-date > div:first-child span { color: var(--ink-4) !important; font-size: 10px !important; }
  .wdb .wdb-date > div:last-child span { color: var(--ink) !important; font-variant-numeric: tabular-nums; }
  .wdb .wdb-ntitle { text-transform: none !important; letter-spacing: 0 !important; font-weight: 700 !important; font-size: 14px !important; line-height: 1.35 !important; color: var(--ink) !important; }
  .wdb .wdb-vtitle { text-transform: none !important; letter-spacing: 0 !important; font-weight: 800 !important; font-size: 14px !important; }

  /* no text under 10px (grade badges keep their own fixed scale) */
  .wdb [style*="font-size: 6px"]:not(.wdb-grade *), .wdb [style*="font-size: 7px"]:not(.wdb-grade *) { font-size: 9px !important; }
  .wdb [style*="font-size: 8px"]:not(.wdb-grade *) { font-size: 10px !important; }
  .wdb [style*="font-size: 9px"]:not(.wdb-grade *) { font-size: 11px !important; }
`;

// Mobile sort menu — the same keys the desktop column headers sort by.
const MOBILE_SORTS = [
  { value: "ClassRank:asc", label: "Class Rank (CRK)" },
  { value: "PositionRank:asc", label: "Position Rank (PRK)" },
  { value: "CommunityGrade:asc", label: "Comm Grade" },
  { value: "MyGrade:asc", label: "My Grade" },
  { value: "Player:asc", label: "Name" },
  { value: "Pick:asc", label: "Draft Pick", only: (is2026) => is2026 },
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

const toMs = (ts) => (ts && ts.toDate ? ts.toDate().getTime() : typeof ts === "number" ? ts : Date.parse(ts) || 0);

// Only ever called with a video's Date (see VideosSidebar below) — a
// date-only value entered via AdminPanel.js's <input type="date">, which
// JS parses as UTC midnight with no real time-of-day meaning. Bucketing by
// *local* calendar day (the previous version) shifted it a day early for
// anyone west of UTC — "8/22" in Firestore reading as "Yesterday" the
// moment it's actually still 8/22 in UTC but already the evening of 8/21
// locally. UTC getters on both sides keep this consistent with how the
// date was entered and stored, not with whichever timezone happens to be
// reading the page.
function formatRelativeTime(input) {
  if (!input) return "";
  const d = input && input.toDate ? input.toDate() : typeof input === "number" ? new Date(input) : new Date(input);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startOfDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
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
    <div className="wdb-grade" style={{
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

const PlusBadge = ({ onClick, loading, small = false, user, login, label }) => {
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
        className="wdb-plus"
        role="button"
        tabIndex={0}
        aria-label={label || "Add to board"}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } }}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
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

// Class rank (blue), then position rank (gold), e.g. "#12" · "#3" — the same numbers
// the player's profile shows (utils/classRanks.js). Both chips are a fixed
// size and both slots are always reserved (an unavailable rank leaves its
// slot empty, never a 0), so every name starts in the same column and the
// chips never run into it. RANK_CHIP holds the sizes so the desktop column
// headers can line up with them.
const RANK_CHIP = {
  desktop: { classW: 46, posW: 46, gap: 12, h: 24, font: 13 },
  mobile: { classW: 36, posW: 36, gap: 6, h: 20, font: 11 },
};
const rankSlotWidth = (s) => s.classW + s.gap + s.posW;
// Desktop position-label column, between the rank chips and the name.
const POS_COL_W = 60;
// Desktop school-logo column, between the position label and the name.
const LOGO_COL_W = 40;
const RankChips = ({ classRank, positionRank, position, small = false }) => {
  const s = small ? RANK_CHIP.mobile : RANK_CHIP.desktop;
  const chip = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    height: s.h + "px", padding: 0, boxSizing: "border-box", flexShrink: 0, overflow: "hidden",
    borderRadius: "5px", fontSize: s.font + "px", fontWeight: 900, lineHeight: 1,
    whiteSpace: "nowrap", letterSpacing: "0.02em", fontFamily: "Arial, sans-serif",
  };
  return (
    <span style={{ display: "inline-flex", gap: s.gap + "px", flexShrink: 0, width: rankSlotWidth(s) + "px" }}>
      {classRank ? (
        <span title={"Class rank " + classRank} aria-label={"Class rank " + classRank} style={{ ...chip, width: s.classW + "px", background: BLUE, color: "#fff" }}>
          #{classRank}
        </span>
      ) : <span aria-hidden="true" style={{ width: s.classW + "px", flexShrink: 0 }} />}
      {positionRank && position ? (
        <span title={position + " rank " + positionRank} aria-label={position + " rank " + positionRank} style={{ ...chip, width: s.posW + "px", background: "#fff7e8", color: "#7a4a00", border: "1.5px solid " + GOLD }}>
          #{positionRank}
        </span>
      ) : <span aria-hidden="true" style={{ width: s.posW + "px", flexShrink: 0 }} />}
    </span>
  );
};

// No community grade yet shows the Watchlist badge (same convention as
// PlayerProfile.js). Display only — sorting and the Comm Grade filter still
// treat the player as ungraded.
const displayCommGrade = (g) => (gradeScale[g] ? g : "Watchlist");

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
        className={"wdb-pill" + (selected.length > 0 ? " on" : "")}
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
        <div className="wdb-menu" style={{
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
          <div className="wdb-stripe" style={{ height: "3px", background: GOLD, flexShrink: 0 }} />
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

// Real <Link>s (not <button>s) — before, these were plain buttons whose
// click handler drove a client-side navigate() once exactly one position
// was selected, so a URL like /community/2027/qb existed but was never
// backed by a real href anywhere on the site: nothing for Google to crawl
// or discover it from. Rendering an actual <a href> here (one per
// position, for the currently-viewed year) fixes that while leaving the
// multi-select toggle click behavior for real users completely unchanged —
// the click handler still preventDefaults and runs the same toggle()
// instead of letting the browser navigate normally.
function PositionFilterBar({ options, selected, setSelected, isMobile, eligibleYear }) {
  // Mobile-only single-select: clicking a position shows just that group
  // (replacing whatever was selected before); clicking the already-active
  // one deselects it and falls back to the whole class. Desktop keeps its
  // original multi-select checkbox-style toggle.
  const toggle = (pos) => setSelected((prev) => {
    if (!isMobile) return prev.includes(pos) ? prev.filter((x) => x !== pos) : [...prev, pos];
    return prev.includes(pos) ? [] : [pos];
  });

  return (
    <div style={{
      display: "flex",
      // Mobile-only: nowrap + horizontal scroll fallback so the (now
      // shorter, K/P-dropped) chip row fits one line; desktop is
      // untouched (wraps, centered, original spacing).
      flexWrap: isMobile ? "nowrap" : "wrap",
      overflowX: isMobile ? "auto" : "visible",
      WebkitOverflowScrolling: "touch",
      gap: isMobile ? "5px" : "8px",
      justifyContent: isMobile ? "flex-start" : "center",
      marginBottom: isMobile ? "8px" : "12px",
    }}>
      {options.map((pos) => {
        const active = selected.includes(pos);
        return (
          <Link
            key={pos}
            to={`/community/${eligibleYear}/${pos.toLowerCase()}`}
            // Plain left-clicks toggle in place; a modified/middle click
            // (open in new tab/window) is left to the browser — before,
            // preventDefault blocked that too.
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault(); toggle(pos);
            }}
            aria-pressed={active}
            className={"wdb-pill wdb-sel" + (active ? " on" : "")}
            style={{
              flexShrink: 0,
              padding: isMobile ? "7px 10px" : "8px 18px",
              fontWeight: 900, fontSize: isMobile ? "12px" : "15px",
              textTransform: "uppercase", letterSpacing: "0.05em",
              border: (isMobile ? "2px" : "3px") + " solid " + GOLD, borderRadius: isMobile ? "8px" : "10px", cursor: "pointer",
              background: active ? BLUE : "#fff",
              color: active ? "#fff" : BLUE,
              whiteSpace: "nowrap", transition: "background 0.15s, color 0.15s",
              textDecoration: "none", display: "inline-block",
            }}
          >
            {pos}
          </Link>
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
        className={"wdb-pill wdb-sel" + (isArchive ? " on" : "")}
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
        <div className="wdb-menu" style={{
          position: "absolute", top: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)",
          zIndex: 50, minWidth: "160px",
          background: "#fff", border: "2px solid " + GOLD, borderRadius: "10px",
          boxShadow: "0 6px 20px rgba(0,0,0,0.14)", overflow: "hidden",
        }}>
          <div style={{ background: BLUE, padding: "8px 14px", fontSize: "11px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Past Draft Classes
          </div>
          <div className="wdb-stripe" style={{ height: "3px", background: GOLD }} />
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
        className="wdb-pill"
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
        <div className="wdb-menu" style={{
          position: "absolute", top: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)",
          zIndex: 50, minWidth: "200px",
          background: "#fff", border: "2px solid " + GOLD, borderRadius: "10px",
          boxShadow: "0 6px 20px rgba(0,0,0,0.14)", overflow: "hidden",
        }}>
          <div style={{ background: BLUE, padding: "8px 14px", fontSize: "11px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Draft Year
          </div>
          <div className="wdb-stripe" style={{ height: "3px", background: GOLD }} />
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
        className="wdb-pill"
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
        <div className="wdb-menu" style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          zIndex: 50, minWidth: "180px",
          background: "#fff", border: "2px solid " + GOLD, borderRadius: "8px",
          boxShadow: "0 6px 16px rgba(0,0,0,0.12)", overflow: "hidden",
        }}>
          <div style={{ background: BLUE, padding: "8px 12px", fontSize: "12px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            My Board
          </div>
          <div className="wdb-stripe" style={{ height: "3px", background: GOLD }} />
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

// `to` makes the header title itself a link, underlined like the player
// page's clickable sidebar headers (e.g. Videos -> /videos).
function SidebarCard({ title, to, color1, color2, children }) {
  return (
    <div className="rounded-lg overflow-hidden wdb-side" style={{ border: "2px solid " + color1 }}>
      <div className="wdb-sidehead" style={{ backgroundColor: color1, padding: "12px 14px", textAlign: "center" }}>
        <div className="font-black uppercase" style={{ color: "#fff", fontSize: "20px", letterSpacing: "0.08em", textAlign: "center" }}>
          {to ? (
            <Link to={to} className="wdb-sidehead-link" style={{ color: "#fff", textDecoration: "underline", textUnderlineOffset: "4px", textDecorationThickness: "2px", textDecorationColor: "rgba(255,255,255,0.55)" }}>
              {title}
            </Link>
          ) : title}
        </div>
      </div>
      <div className="wdb-stripe" style={{ height: "4px", backgroundColor: color2 }} />
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
  // it snapshots before the player list has loaded. positionParam stays the
  // raw (possibly comma-joined — see NFLTeamPage.jsx's "+" links, e.g.
  // /community/2027/dl,edge) URL segment for anything that just echoes it
  // back into a URL; positionParams is the parsed array for anything that
  // needs to reason about each position individually. ──
  const positionParam = position ? position.toUpperCase() : null;
  const positionParams = positionParam ? positionParam.split(",").map((p) => p.trim()).filter(Boolean) : [];
  const positionLabel = positionParams.length > 0
    ? positionParams.map((p) => POSITION_LABELS[p] || p).join(" / ")
    : null;

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
  // Separate from `loading` (which clears after phase 1 of the fetch below)
  // so the board keeps showing the spinner until community grades are in,
  // instead of flashing an alphabetical board that then re-sorts. Kept off
  // `loading` so the mobile stuck-page watchdog's 3s reload timer doesn't
  // fire while the slower grade hydration is still running.
  const [gradesReady, setGradesReady] = useState(false);
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

  // ── Same mobile stuck-page reload as PlayerProfile.js/TeamPage.js/etc —
  // a backgrounded tab can leave this page's fetch hanging indefinitely,
  // so force a real reload after 3s (or on tab refocus) rather than let it
  // spin forever. Keyed on year+position so switching boards resets it. ──
  useMobileStuckPageWatchdog(loading, `community_${eligibleYear}_${positionParam || "all"}`, { enabled: isMobile });

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

  // null = this page's default sort (see defaultSortKey below), so the
  // default always follows the current page instead of a stale choice.
  const [sortKey, setSortKey] = useState(null);
  const [sortOrder, setSortOrder] = useState("asc");
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile filter panel
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
    }
  }, [eligibleYear]);

  // ── Context-aware default sort. A single-position page
  // (/community/2027/wr) ranks by position rank; a class page
  // (/community, /community/2028) — and a multi-position deep link like
  // /community/2027/dl,edge, where DL1 and EDGE1 can't be ordered against
  // each other — ranks by class rank. Any change of page (year or
  // position, including the position chips, which change the URL) drops a
  // manual column sort back to that page's default. ──
  const defaultSortKey = positionParams.length === 1 ? "PositionRank" : "ClassRank";
  const effectiveSortKey = sortKey || defaultSortKey;
  useEffect(() => {
    setSortKey(null);
    setSortOrder("asc");
  }, [eligibleYear, position]);

  const programmaticNavRef = useRef(false);

  useEffect(() => {
    if (programmaticNavRef.current) {
      programmaticNavRef.current = false;
      return;
    }
    // posList is normally 0 or 1 positions (the position bar is single-
    // select — see PositionFilterBar's own toggle), but a deep link can
    // land here with more than one (comma-joined, e.g. NFLTeamPage.jsx's
    // "+" button linking a Defensive Line group to /community/2027/dl,edge)
    // — those just seed selectedPositions with every position listed.
    const posList = position ? position.toUpperCase().split(",").map((p) => p.trim()).filter(Boolean) : [];
    setSelectedPositions((prev) => {
      const same = prev.length === posList.length && posList.every((p) => prev.includes(p));
      return same ? prev : posList;
    });
  }, [position]);

  useEffect(() => {
    // Sorted so a 2+-position deep link's URL round-trips as the same
    // string regardless of selection order, instead of this effect
    // reading it as "changed" and re-navigating in a loop.
    const currentPos = position ? position.toUpperCase().split(",").sort().join(",") : null;
    const desiredPos = selectedPositions.length > 0 ? [...selectedPositions].sort().join(",") : null;
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
              // A Short (AdminPanel.js's "Format" checkbox) is a 30s-1min
              // vertical clip meant for a player page's own Watch button,
              // not a long-form breakdown — excluded here same as
              // PlayerProfile.js's own Videos sidebar.
              short: data.Short === true,
              title: data.GenTitle || (first && first.title) || "",
              thumb: data.GenThumb || (first && first.thumb) || "",
              tags: Array.isArray(data.Tags) ? data.Tags : [],
            };
          })
          // Recruiting-tagged videos don't belong on the (draft-class-
          // focused) Community Board sidebar — an untagged video (nothing
          // set yet in AdminPanel.js's Videos tab) is never excluded here,
          // only an explicit Recruiting tag is.
          .filter(function (v) { return !!v.video && !v.short && !v.tags.includes("Recruiting"); })
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
      setGradesReady(true);
      setSeoDataReady(true);
      return;
    }

    const isActiveYear = ACTIVE_YEARS.includes(eligibleYear);
    const isArchiveYear = ARCHIVE_YEARS.includes(eligibleYear);
    if (!isActiveYear && !isArchiveYear) {
      // No matching year — nothing to fetch, but loading must still clear
      // or this route hangs on the spinner forever.
      setLoading(false);
      setGradesReady(true);
      setSeoDataReady(true);
      return;
    }

    let cancelled = false;

    const fetchPlayers = async () => {
      setLoading(true);
      setGradesReady(false);
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

        // Phase 1 done — clears `loading` (for the stuck-page watchdog), but
        // the spinner stays up via gradesReady, and prerenderReady waits for
        // phase 2 too so Prerender.io snapshots the sorted board, not the
        // spinner.
        setPlayers(basePlayers);
        setLoading(false);

        // Phase 2 — community grades: one snapshot read for the whole class
        // (utils/communityGrades.js), not one evaluations query per player.
        // Alongside it, the class/position rank chips: the same weekly
        // class_{year}_{pos} snapshot docs PlayerProfile.js's Class Rank box
        // reads (one per position in the class, cached for the session), so
        // the board and each profile show identical ranks. A missing doc or
        // player just means no chip for them.
        const classPositions = [...new Set(basePlayers.map((p) => p.Position).filter(Boolean))];
        const [avgs, rankDocs] = await Promise.all([
          averageGradesFor(basePlayers.map((p) => p.id)),
          Promise.all(classPositions.map((pos) => getSiteSnapshot(`class_${eligibleYear}_${pos}`))),
        ]);
        const ranks = Object.assign({}, ...rankDocs.map(classSnapshotRanks));
        // School logos for the desktop rows: the same snapshot rows carry
        // each school's logo (lg); only schools missing from them get a
        // batched schools lookup (same "in" chunks PlayerProfile.js uses).
        const logoBySchool = {};
        rankDocs.forEach((d) => (d?.rows || []).forEach((r) => { if (r.s && r.lg) logoBySchool[r.s] = r.lg; }));
        const missingSchools = [...new Set(basePlayers.map((p) => p.School).filter((s) => s && !(s in logoBySchool)))];
        try {
          const chunks = [];
          for (let i = 0; i < missingSchools.length; i += 10) chunks.push(missingSchools.slice(i, i + 10));
          const snaps = await Promise.all(chunks.map((c) => getDocs(query(collection(db, "schools"), where("School", "in", c)))));
          snaps.forEach((s) => s.docs.forEach((d) => { const sd = d.data(); if (sd.School) logoBySchool[sd.School] = sd.Logo1 || ""; }));
        } catch (e) { console.error("Board school logo fetch error:", e); }
        const withGrades = basePlayers.map((p) => {
          p.CommunityGrade = gradeLabel(avgs[p.id]) || "-";
          p.ClassRank = ranks[p.id]?.classRank ?? null;
          p.PositionRank = ranks[p.id]?.positionRank ?? null;
          p.SchoolLogo = logoBySchool[p.School] || "";
          return p;
        });

        if (cancelled) return;
        setPlayers(withGrades);
        setPlayerCache((prev) => ({ ...prev, [eligibleYear]: withGrades }));
        setGradesReady(true);
        setSeoDataReady(true);
      } catch (err) {
        console.error("Error fetching players:", err);
        if (!cancelled) {
          setLoading(false);
          setGradesReady(true);
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
        uid: user.uid,
        playerId: p.id,
        playerName: (p.First || "") + " " + (p.Last || ""),
        grade: "Watchlist", strengths: [], weaknesses: [],
        nflFit: "", evaluation: "", visibility: "private",
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, "players", p.id, "evaluations", user.uid), canonicalEvalData(evalData));
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
    if (effectiveSortKey === key) { setSortKey(key); setSortOrder(sortOrder === "asc" ? "desc" : "asc"); }
    else { setSortKey(key); setSortOrder("asc"); }
  };

  const resetFilters = () => {
    setSelectedSchools([]); setSelectedPositions([]);
    setSelectedCommGrades([]); setSelectedMyGrades([]);
    setSearchQuery(""); setShowAvailableOnly(false); setShowInactive(false);
    setSortKey(null); setSortOrder("asc");
  };

  const is2026 = eligibleYear === "2026";
  // Rank columns only when this board has ranks at all (an archive year
  // with no class snapshot has none — no point reserving empty slots).
  const showRanks = players.some((p) => p.ClassRank || p.PositionRank);
  const activeFilterCount = selectedSchools.length + selectedMyGrades.length + selectedCommGrades.length + (showAvailableOnly ? 1 : 0);
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

  // Ties (and unranked players, which always go last): community grade,
  // then name — a fixed order, so equal ranks never shuffle between renders.
  const byGradeThenName = (a, b) => {
    const g = compareRanks(gradeScale[a.CommunityGrade], gradeScale[b.CommunityGrade]);
    if (g !== 0) return g;
    return (a.Last || "").localeCompare(b.Last || "") || (a.First || "").localeCompare(b.First || "");
  };
  const sortKeyNow = effectiveSortKey;
  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    if (sortKeyNow === "ClassRank" || sortKeyNow === "PositionRank") {
      const field = sortKeyNow;
      const r = compareRanks(a[field], b[field], sortOrder);
      if (r !== 0) return r;
      // Position rank restarts per position on a multi-position view —
      // class rank orders equal position ranks before the grade fallback.
      const c = field === "PositionRank" ? compareRanks(a.ClassRank, b.ClassRank, sortOrder) : 0;
      return c !== 0 ? c : byGradeThenName(a, b);
    }
    const sortKey = sortKeyNow;
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
  // Mobile-only: Kicker/Punter dropped so the chip row fits one line on a
  // narrow screen. Desktop keeps the full allPositions list unchanged.
  const mobilePositions = allPositions.filter((pos) => pos !== "K" && pos !== "P");
  // Stats button (left of School): the selected position(s)' national stat
  // table on the CFB page (/cfb/stats/:group, components/CfbLeaders.js),
  // filtered to this class. Only when every selected position maps to the
  // same table, and only for classes still in college (2027+).
  const statsGroup = (() => {
    const groups = new Set(selectedPositions.map((pos) => STATS_GROUP[pos]));
    if (groups.size !== 1 || groups.has(undefined) || Number(eligibleYear) < 2027) return null;
    return [...groups][0];
  })();
  const statsButton = statsGroup && (
    <Link to={`/cfb/stats/${statsGroup}?class=${eligibleYear}`} className="wdb-pill" style={{
      padding: "8px 16px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em",
      color: "#fff", background: BLUE, border: "2px solid " + GOLD, borderRadius: "8px", whiteSpace: "nowrap",
      textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
    }}>
      📊 Stats
    </Link>
  );
  const allSchools = [...new Set(players.map((p) => p.School).filter(Boolean))].sort();

  // Until community grades are in, the page chrome (header, filters,
  // sidebars) renders as normal and only the ranking list shows a spinner —
  // never an alphabetical list that then re-sorts.
  const listLoading = loading || !gradesReady;
  const ListSpinner = <div style={{ background: "#fff" }}><LoadingSpinner label="Loading Board" size={48} minHeight="320px" /></div>;

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
            <div className="flex-shrink-0 rounded overflow-hidden wdb-date" style={{ width: 36, border: "2px solid " + BLUE, background: "#fff", display: "flex", flexDirection: "column" }}>
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
              <div className="font-black uppercase leading-tight wdb-ntitle" style={{ color: "#222", letterSpacing: "0.03em", fontSize: "12px" }}>{n.title}</div>
            </div>
          </Link>
        ))
      )}
    </SidebarCard>
  );

  const VideosSidebar = (
    <SidebarCard title="Videos" to="/videos" color1={BLUE} color2={GOLD}>
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
                    <div className="font-black uppercase leading-tight wdb-vtitle" style={{ color: "#fff", fontSize: "13px", letterSpacing: "0.03em", textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}>
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
      {/* Compact header — no site logo (the navbar already carries it);
          the title names the board being viewed. */}
      <div className="wdb-hero" style={{ marginBottom: isMobile ? "10px" : "14px", border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{
          background: BLUE, padding: isMobile ? "10px 12px" : "14px 20px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
        }}>
          <h1 style={{
            fontSize: isMobile ? "22px" : "36px", fontWeight: 900, textTransform: "uppercase",
            letterSpacing: "0.03em", color: "#fff", lineHeight: 1.05, textAlign: "center", width: "100%",
            margin: 0,
          }}>
            {eligibleYear + " "}<span style={{ color: GOLD }}>{positionLabel || "Draft Class"}</span>{" Rankings"}
          </h1>
          <div style={{ fontSize: isMobile ? "10px" : "12px", fontWeight: 700, color: "rgba(255,255,255,0.8)", letterSpacing: "0.06em", textTransform: "uppercase", textAlign: "center", lineHeight: 1.3 }}>
            {eligibleYear + " NFL Draft " + (positionLabel ? positionLabel + " Board" : "Community Board") + " · Ranked by Community Grades"}
          </div>
        </div>
        <div className="wdb-stripe" style={{ height: "3px", background: GOLD }} />
      </div>

      {/* Draft Year — desktop only up here now; on mobile the year filter
          moved down into the 2x2 filter grid (in Position's old slot, as a
          YearDropdown button) instead of getting its own row, since
          Position now gets the same full chip bar desktop uses (see
          below) and there wasn't room for both a standalone year row and a
          standalone position row on a narrow screen. */}
      {!isMobile && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
            <ArchiveDropdown eligibleYear={eligibleYear} onSelect={(yr) => navigate(yearPath(yr))} />
            {ACTIVE_YEARS.map((yr) => (
              <Link
                key={yr}
                to={yearPath(yr)}
                aria-current={eligibleYear === yr ? "page" : undefined}
                className={"wdb-pill wdb-sel" + (eligibleYear === yr ? " on" : "")}
                style={{
                  border: "2px solid " + GOLD, borderRadius: "20px",
                  padding: "7px 24px",
                  fontWeight: 900, fontSize: "16px",
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
        </div>
      )}

      {/* Desktop-only Position chip row, unchanged from before the mobile
          rework — mobile gets its own copy further down (see the "Position
          — its own centered row" comment below), scoped to mobile-only
          fixes (single-select toggle, K/P dropped, one-line sizing). */}
      {!is2029Empty && !isMobile && (
        <PositionFilterBar options={allPositions} selected={selectedPositions} setSelected={setSelectedPositions} isMobile={isMobile} eligibleYear={eligibleYear} />
      )}

      {is2029Empty ? (
        <div className="wdb-card" style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
          <div className="wdb-cardhead" style={{ background: BLUE, padding: "8px 16px" }}>
            <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>2029 Draft Class</div>
          </div>
          <div className="wdb-stripe" style={{ height: "3px", background: GOLD }} />
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
              {/* Always-visible row: year, the collapsible Filters toggle
                  (count of active filters on it), and sort — so the board
                  itself stays above the fold instead of under a tall grid. */}
              <div className="wd-mobile-filter-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
                <YearDropdown eligibleYear={eligibleYear} onSelect={(yr) => navigate(yearPath(yr))} />
                <button
                  onClick={() => setFiltersOpen((o) => !o)}
                  aria-expanded={filtersOpen}
                  aria-controls="wd-board-filters"
                  className={"wdb-pill" + (filtersOpen || activeFilterCount ? " on" : "")}
                  style={{
                    padding: "8px 12px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em",
                    color: filtersOpen || activeFilterCount ? "#fff" : BLUE, background: filtersOpen || activeFilterCount ? BLUE : "#fff",
                    border: "2px solid " + GOLD, borderRadius: "8px", cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  Filters{activeFilterCount ? " (" + activeFilterCount + ")" : ""} {filtersOpen ? "▴" : "▾"}
                </button>
              </div>
              {filtersOpen && (
              <div id="wd-board-filters" className="wd-mobile-filter-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
                {statsButton}
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
                    className={"wdb-pill" + (showAvailableOnly ? " on" : "")}
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
              )}
              {/* Position — mobile-only fix: its own row above the search
                  box, using the K/P-dropped mobilePositions list (scrolls
                  sideways if it still doesn't fit). Desktop's chip row stays
                  up top with the full allPositions list. */}
              <PositionFilterBar options={mobilePositions} selected={selectedPositions} setSelected={setSelectedPositions} isMobile={isMobile} eligibleYear={eligibleYear} />
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <input type="search" className="wdb-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search player..." aria-label="Search players"
                  style={{ flex: 1, minWidth: 0, boxSizing: "border-box", border: "2px solid " + GOLD, borderRadius: "8px", padding: "8px 12px", fontWeight: 700, fontSize: "14px", color: BLUE, outline: "none" }} />
                <select
                  value={effectiveSortKey + ":" + sortOrder}
                  onChange={(e) => { const [k, o] = e.target.value.split(":"); setSortKey(k); setSortOrder(o); }}
                  aria-label="Sort players"
                  className="wdb-input"
                  style={{ flexShrink: 0, maxWidth: "46%", border: "2px solid " + GOLD, borderRadius: "8px", padding: "8px 6px", fontWeight: 800, fontSize: "12px", color: BLUE, background: "#fff" }}
                >
                  {MOBILE_SORTS.filter((s) => !s.only || s.only(is2026)).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              {(activeFilterCount > 0 || searchQuery) && (
                <div style={{ textAlign: "center", marginTop: "4px" }}>
                  <button onClick={resetFilters} style={{ background: "none", border: "none", color: "#777", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Reset Filters</button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", justifyContent: "center", marginBottom: "10px" }}>
              {statsButton}
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
                    className={"wdb-pill" + (showAvailableOnly ? " on" : "")}
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
              <input type="text" className="wdb-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search player..."
                style={{ border: "2px solid " + GOLD, borderRadius: "8px", padding: "8px 14px", fontWeight: 700, fontSize: "13px", color: BLUE, outline: "none", width: "280px" }} />
              <button onClick={resetFilters} style={{ background: "none", border: "none", color: "#999", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Reset</button>
            </div>
          )}

          <div className="wdb-card" style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
            <div className="wdb-cardhead" style={{ background: BLUE, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {selectedPositions.length > 0
                  ? (eligibleYear + " " + selectedPositions.map((p) => POSITION_LABELS[p] || p).join(" / ") + " Rankings")
                  : (eligibleYear + " Draft Class")}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px", fontWeight: 700 }}>
                  {listLoading ? "" : sortedPlayers.length + " player" + (sortedPlayers.length !== 1 ? "s" : "")}
                </div>
                {/* "View All" — small and easy to miss on purpose, since
                    non-live players are hidden by an admin's own deliberate
                    choice; this is an opt-in escape hatch, not something
                    most visitors need front-and-center. Only shows up at all
                    when there's actually something it would add. */}
                {!listLoading && (inactiveHiddenCount > 0 || showInactive) && (
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
            <div className="wdb-stripe" style={{ height: "3px", background: GOLD }} />

            {isMobile ? (
              <div style={{ maxHeight: "calc(70vh / var(--pz, 1))", overflowY: "auto" }}>
                {listLoading ? ListSpinner : sortedPlayers.length === 0 ? (
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
                    <div key={p.id} className="wdb-row" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 8px 8px 10px", background: "#fff", borderBottom: "1px solid " + GOLD }}>
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
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                          {showRanks && (
                            <RankChips classRank={p.ClassRank} positionRank={p.PositionRank} position={p.Position} small />
                          )}
                          <Link
                            to={"/player/" + p.Slug}
                            style={{ color: BLUE, fontWeight: 900, fontSize: "15px", textDecoration: "none", display: "block", lineHeight: 1.2, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                          >
                            {(p.First || "") + " " + (p.Last || "")}
                          </Link>
                        </div>
                        {/* Position · school · size on one line — truncates
                            instead of wrapping so every row stays the same
                            compact height. */}
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "#555", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.Position || "—"} · {p.School || "—"}
                          {(p.HeightInches || p.Weight) && (
                            <span style={{ color: "#888" }}>
                              {" · "}{p.HeightInches ? formatHeight(p.HeightInches) : ""}{p.HeightInches && p.Weight ? ", " : ""}{p.Weight ? (p.Weight + " lbs") : ""}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
                        <div style={{ fontSize: "8px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>My</div>
                        {isAdding ? (
                          <div style={{ width: "48px", height: "40px", border: "2px solid " + BLUE, borderRadius: "5px", opacity: 0.4 }} />
                        ) : onBoard ? (
                          <GradeBadge grade={myGrade} small />
                        ) : (
                          <PlusBadge onClick={() => handleAddToBoard(p)} loading={isAdding} small user={user} login={login} label={"Add " + ((p.First || "") + " " + (p.Last || "")).trim() + " to your board"} />
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
                        <div style={{ fontSize: "8px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>Comm</div>
                        <GradeBadge grade={displayCommGrade(p.CommunityGrade)} small />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ maxHeight: "760px", overflowY: "auto" }}>
                {(() => {
                  const SortLabel = ({ sortK, label, align = "center", width, title }) => {
                    const active = effectiveSortKey === sortK;
                    return (
                      <button
                        type="button"
                        onClick={() => handleSort(sortK)}
                        title={title}
                        aria-label={"Sort by " + (title || label)}
                        aria-pressed={active}
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
                          background: "none", border: "none", padding: 0, fontFamily: "inherit",
                        }}
                      >
                        <span style={{ whiteSpace: "nowrap" }}>{label}</span>
                        <span aria-hidden="true" style={{ fontSize: "10px", opacity: active ? 1 : 0.5 }}>
                          {active ? (sortOrder === "asc" ? "▲" : "▼") : "▲"}
                        </span>
                      </button>
                    );
                  };
                  return (
                    <div className="wdb-colhead" style={{
                      position: "sticky", top: 0, zIndex: 10,
                      display: "flex", alignItems: "center", gap: "16px",
                      background: "linear-gradient(135deg, " + BLUE + ", #003d7a)",
                      padding: "12px 20px",
                    }}>
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
                  );
                })()}
                <div className="wdb-stripe" style={{ height: "3px", background: GOLD }} />

                {listLoading ? ListSpinner : sortedPlayers.length === 0 ? (
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
                      className="wdb-row"
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

                      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "14px" }}>
                        {showRanks && <RankChips classRank={p.ClassRank} positionRank={p.PositionRank} position={p.Position} />}
                        {/* Position label sits directly left of the name. */}
                        <div style={{ width: POS_COL_W + "px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                          {p.Position ? (
                            <span style={{ fontSize: "14px", fontWeight: 900, color: BLUE, background: "#eaf1ff", padding: "6px 0", width: "100%", textAlign: "center", borderRadius: "6px", textTransform: "uppercase" }}>
                              {p.Position}
                            </span>
                          ) : <span style={{ color: "#ddd" }}>—</span>}
                        </div>
                        {/* School logo between position and name (the school
                            name text was dropped — the logo carries it, with
                            the name as alt/tooltip). Fixed slot so names stay
                            in one column with or without a logo. */}
                        <div style={{ width: LOGO_COL_W + "px", height: LOGO_COL_W + "px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {p.SchoolLogo && (
                            <img src={sanitizeUrl(p.SchoolLogo)} alt={p.School || ""} title={p.School || undefined} loading="lazy"
                              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                              onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          )}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <Link
                            to={"/player/" + p.Slug}
                            style={{ color: BLUE, fontWeight: 900, fontSize: "28px", textDecoration: "none", display: "block", lineHeight: 1.1, overflowWrap: "break-word" }}
                            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                          >
                            {(p.First || "") + " " + (p.Last || "")}
                          </Link>
                        </div>
                      </div>

                      <div style={{ width: "104px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                        {isAdding ? (
                          <div style={{ width: "64px", height: "52px", border: "2px solid " + BLUE, borderRadius: "5px", opacity: 0.4 }} />
                        ) : onBoard ? (
                          <GradeBadge grade={myGrade} />
                        ) : (
                          <PlusBadge onClick={() => handleAddToBoard(p)} loading={isAdding} user={user} login={login} label={"Add " + ((p.First || "") + " " + (p.Last || "")).trim() + " to your board"} />
                        )}
                      </div>

                      <div style={{ width: "104px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                        <GradeBadge grade={displayCommGrade(p.CommunityGrade)} />
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

          {!user && (
            <p style={{ textAlign: "center", marginTop: "14px", fontSize: "13px", color: "#999", fontWeight: 700 }}>
              <span onClick={login} style={{ color: BLUE, fontWeight: 900, cursor: "pointer", textDecoration: "underline" }}>Sign in</span> to add players to your board
            </p>
          )}
        </>
      )}
    </div>
  );

  // Modern look (BOARD_MODERN_STYLE) — on by default; ?modern=0 shows the
  // old look for comparison.
  const modern = typeof window === "undefined" || new URLSearchParams(window.location.search).get("modern") !== "0";

  return (
    <>
      {SeoTags}
      {modern && <style>{BOARD_MODERN_STYLE}</style>}

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
        <div className={modern ? "wdb" : undefined} style={{ padding: "4px 10px 60px", display: "flex", flexDirection: "column", gap: "24px" }}>
          <div style={{ maxWidth: "700px", margin: "0 auto", width: "100%" }}>{MainContent}</div>
          {sidebarNews.length > 0 && <div style={{ maxWidth: "700px", margin: "0 auto", width: "100%" }}>{NewsSidebar}</div>}
          {sidebarVideos.length > 0 && <div style={{ maxWidth: "700px", margin: "0 auto", width: "100%" }}>{VideosSidebar}</div>}
        </div>
      ) : (
        <div className={modern ? "wdb" : undefined} style={{ maxWidth: "1900px", margin: "0 auto", padding: "6px 24px 60px", display: "grid", gridTemplateColumns: "280px minmax(0, 1300px) 280px", gap: "20px", alignItems: "start" }}>
          {/* Left column is the ad rail; News only shows in the mobile stack. */}
          <div style={{ position: "sticky", top: "20px" }}><SideRailAd isMobile={isMobile} /></div>
          <div>{MainContent}</div>
          <div style={{ position: "sticky", top: "20px" }}>{VideosSidebar}</div>
        </div>
      )}
    </>
  );
}