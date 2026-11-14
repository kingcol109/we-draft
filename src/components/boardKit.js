// src/components/boardKit.js
//
// What the Community Board (CommunityBoard.js) and My Boards (UserBoards.js)
// share so the two pages look the same: the modern style sheet (scoped to a
// .wdb wrapper, keyed off wdb-* class names on the page's own elements), the
// class/position rank chips, and the desktop row's fixed column widths.
import { useEffect, useRef, useState } from "react";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// ── Modern look — the player page's design language (PlayerProfile.js's
// MODERN_STYLE): light page, 1px hairlines instead of 2–3px blue/gold
// borders, one radius scale (10 / 14 / pill), compact left-anchored blue
// headers, outline-by-default pills (filled only when active), no gold
// stripes, no sub-10px text. Scoped under .wdb and layered over the
// existing inline styles (hence !important); ?modern=0 shows the old look. ──
export const BOARD_MODERN_STYLE = `
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

// Class rank (blue), then position rank (gold), e.g. "#12" · "#3" — the same numbers
// the player's profile shows (utils/classRanks.js). Both chips are a fixed
// size and both slots are always reserved (an unavailable rank leaves its
// slot empty, never a 0), so every name starts in the same column and the
// chips never run into it. RANK_CHIP holds the sizes so the desktop column
// headers can line up with them.
export const RANK_CHIP = {
  desktop: { classW: 46, posW: 46, gap: 12, h: 24, font: 13 },
  mobile: { classW: 36, posW: 36, gap: 6, h: 20, font: 11 },
};
export const rankSlotWidth = (s) => s.classW + s.gap + s.posW;
// Desktop position-label column, between the rank chips and the name.
export const POS_COL_W = 60;
// Desktop school-logo column, between the position label and the name.
export const LOGO_COL_W = 40;
export const RankChips = ({ classRank, positionRank, position, small = false }) => {
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

// A filter menu of checkboxes (School, My Grade, Comm Grade).
export function DropdownChecklist({ title, options, selected, setSelected, ordered = false }) {
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

// The Archive pill and its menu of past classes.
export function ArchiveDropdown({ eligibleYear, onSelect, archiveYears }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const isArchive = archiveYears.includes(eligibleYear);

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
          {archiveYears.map((yr) => (
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

// ── Grades and sizes, shared by the Community Board and the Transfer
// Portal (pages/TransferPortal.jsx). ──
export const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
  "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
  "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, UDFA: 10,
};

export const gradeDisplay = (g) => {
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

export const GradeBadge = ({ grade, small = false }) => {
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

export const PlusBadge = ({ onClick, loading, small = false, user, login, label }) => {
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

// No community grade yet shows the Watchlist badge (same convention as
// PlayerProfile.js). Display only — sorting and the Comm Grade filter still
// treat the player as ungraded.
export const displayCommGrade = (g) => (gradeScale[g] ? g : "Watchlist");

export const formatHeight = (inches) => {
  if (!inches) return "-";
  const ft = Math.floor(inches / 12);
  const inch = Math.round((inches % 12) * 10) / 10;
  return ft + "'" + inch + "\"";
};

export const parseHeight = (val) => {
  if (!val) return NaN;
  if (typeof val === "number") return val;
  const match = String(val).match(/^(\d+)'([\d.]+)"/);
  if (match) return parseInt(match[1], 10) * 12 + parseFloat(match[2]);
  return NaN;
};
