import React, { useEffect, useState, useRef } from "react";
import ReactDOM from "react-dom";
import { collection, getDocs, doc, setDoc, serverTimestamp, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";
import Logo2 from "../assets/Logo2.png";
import EliteFlair from "../assets/elite.png";
import StarFlair from "../assets/star.png";
import DiamondFlair from "../assets/dir.png";
import RadarFlair from "../assets/radar.png";
import SecondFlair from "../assets/second.png";
import AlienFlair from "../assets/alien.png";
import FutureStarFlair from "../assets/futurestar.png";
import CurveFlair from "../assets/curve.png";
import EarlyImpactFlair from "../assets/early impact.png";
import EarlyContributorFlair from "../assets/early contributor.png";
import Year2ContributorFlair from "../assets/y2contributor.png";
import DevelopmentalFlair from "../assets/developmental.png";
import ProvenFlair from "../assets/proven.png";

// ── Flair -> { image, stroke color, description } — mirrors the map on
// PlayerProfile.js so a flair means the same thing (same icon, color, and
// hover copy) everywhere it shows up on the site. ──
const FLAIR_CONFIG = {
  "Elite":               { img: EliteFlair,      stroke: "#ff0000",  desc: "Player is one of the best in the country." },
  "Star":                { img: StarFlair,        stroke: "#ebac02", desc: "Player is one of the best at his position." },
  "Diamond in the Rough": { img: DiamondFlair,   stroke: "#00d2ff", desc: "Player has shown flashes of talent and can take the next step with a little more polish." },
  "Under the Radar":     { img: RadarFlair,       stroke: "#79f146", desc: "Player has outperformed his level of hype." },
  "Future Star":         { img: FutureStarFlair,  stroke: "#0055a5", desc: "Player has shown flashes of elite talent." },
  "Alien":               { img: AlienFlair,       stroke: "#5c04c9", desc: "Player has a rare trait." },
  "Second Chance":       { img: SecondFlair,      stroke: "#ff6600", desc: "Player's production or performance may have slipped some but they have a chance to bounce back." },
  "Ahead of the Curve":  { img: CurveFlair,       stroke: "#008aff", desc: "Player has produced early in his CFB career." },
  "Early Impact":        { img: EarlyImpactFlair, stroke: "#009295", desc: "Player has the traits to make an impact early in his college football career. \"High 5-Star\".", tag: "Recruit Grade" },
  "Early Contributor":   { img: EarlyContributorFlair, stroke: "#ff00f0", desc: "Player has a trait or two that will allow him to see the field early in his college football career. \"Low 5-Star/High 4-Star\".", tag: "Recruit Grade" },
  "Year 2 Contributor":  { img: Year2ContributorFlair, stroke: "#3b6b03", desc: "Player is close to CFB ready but needs a little more development before he is ready to contribute. \"4-Star\".", tag: "Recruit Grade" },
  "Developmental":       { img: DevelopmentalFlair, stroke: "#fff600", desc: "Player needs development before he is ready to see the field. \"3-Star\".", tag: "Recruit Grade" },
  "Proven":              { img: ProvenFlair,      stroke: "#00124b", desc: "Player has proven to be an effective college football player." },
};

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const ARCHIVE_YEARS = ["2026"];
const ACTIVE_YEARS = ["2027", "2028", "2029"];

// ── Full labels for position-specific SEO titles/descriptions, e.g.
// "2027 NFL Draft Quarterback Rankings". Falls back to the raw code for any
// position that shows up in the data but isn't listed here. ──
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

const GradeBadge = ({ grade, small = false }) => {
  const w = small ? "48px" : "64px";
  const h = small ? "40px" : "52px";
  const numSz = small ? "14px" : "18px";
  const lblSz = small ? "5.5px" : "7px";
  const gd = gradeDisplay(grade);
  if (!gd) return (
    <div style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: w, height: h, border: "2px solid #ddd", borderRadius: "5px",
      color: "#ccc", fontSize: small ? "14px" : "18px", fontWeight: 900,
    }}>—</div>
  );
  const isFirstRound = ["Early First Round", "Middle First Round", "Late First Round"].includes(grade);
  const qualifier = isFirstRound ? grade.replace(" First Round", "").toUpperCase() : null;
  return (
    <div style={{
      display: "inline-flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", backgroundColor: gd.bg, border: `2px solid ${gd.border}`,
      borderRadius: "5px", width: w, height: h, flexShrink: 0, gap: "1px",
    }}>
      {qualifier && <span style={{ fontSize: small ? "6px" : "7.5px", fontWeight: 900, color: "rgba(255,255,255,0.9)", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1, textAlign: "center" }}>{qualifier}</span>}
      <span style={{ fontSize: numSz, fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.02em", textAlign: "center" }}>{gd.short}</span>
      <span style={{ fontSize: lblSz, fontWeight: 800, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center", lineHeight: 1.1 }}>{grade === "Watchlist" ? "LIST" : "ROUND"}</span>
    </div>
  );
};

// ── PlusBadge with hover tooltip and unauthenticated modal trigger ──
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
          width: w, height: h, border: `2px solid ${BLUE}`, borderRadius: "5px",
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
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          border: `2px solid ${GOLD}`, borderRadius: "20px",
          padding: "6px 18px", fontWeight: 900, fontSize: "14px",
          cursor: "pointer",
          background: isArchive ? BLUE : "#fff",
          color: isArchive ? "#fff" : BLUE,
          display: "flex", alignItems: "center", gap: "6px",
          whiteSpace: "nowrap",
        }}
      >
        {isArchive ? `Archive: ${eligibleYear}` : "Archive"} ▾
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)",
          zIndex: 50, minWidth: "160px",
          background: "#fff", border: `2px solid ${GOLD}`, borderRadius: "10px",
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

function BoardDropdown({ dropdownRef, open, setOpen, isMobile, onNavigate, onMyBoards }) {
  return (
    <div ref={dropdownRef} style={{ position: "relative", display: "inline-block", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        style={{
          padding: isMobile ? "8px 14px" : "8px 16px",
          fontWeight: 900, fontSize: isMobile ? "12px" : "13px",
          textTransform: "uppercase", letterSpacing: "0.05em",
          border: `2px solid ${GOLD}`, borderRadius: "8px", cursor: "pointer",
          background: "#fff", color: BLUE, whiteSpace: "nowrap",
        }}
      >
        My Board ▾
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
            📋 My Boards
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

export default function CommunityBoard() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const { year, position } = useParams();

  const eligibleYear = year || "2027";

  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [boardDropdownOpen, setBoardDropdownOpen] = useState(false);
  const boardDropdownRef = useRef(null);

  const [draftMap, setDraftMap] = useState({});
  const [nflTeams, setNflTeams] = useState({});

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

  const [boardMap, setBoardMap] = useState(new Map());
  const [addingId, setAddingId] = useState(null);

  // ── Mini player preview card: hovering a player's name shows a compact
  // summary card (grades, position/school, flair if they have one). Themed
  // by the player's flair color when present, plain site blue otherwise.
  // Delayed like the old flair popup — a short pause before it appears so
  // scanning quickly down a long list doesn't spam a card on every row.
  // Rendered via portal into document.body with position:fixed (computed
  // from the trigger's real getBoundingClientRect, same escape-hatch pattern
  // TeamPage.js's filter dropdowns use) — otherwise rows near the bottom of
  // the scrollable table get their card clipped by that container's own
  // overflow boundary. Flips to open upward when there isn't room below. ──
  const [hoveredPlayerId, setHoveredPlayerId] = useState(null);
  const [hoverCardPos, setHoverCardPos] = useState({ top: 0, left: 0, flip: false });
  const playerHoverTimerRef = useRef(null);
  const PREVIEW_CARD_HEIGHT_ESTIMATE = 240;

  const handlePlayerHoverEnter = (id, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    clearTimeout(playerHoverTimerRef.current);
    playerHoverTimerRef.current = setTimeout(() => {
      const flip = window.innerHeight - rect.bottom < PREVIEW_CARD_HEIGHT_ESTIMATE + 16;
      setHoverCardPos({
        left: rect.left,
        top: flip ? rect.top - PREVIEW_CARD_HEIGHT_ESTIMATE - 12 : rect.bottom + 12,
        flip,
      });
      setHoveredPlayerId(id);
    }, 450);
  };
  const handlePlayerHoverLeave = () => {
    clearTimeout(playerHoverTimerRef.current);
    setHoveredPlayerId(null);
  };

  const PlayerPreviewCard = ({ player, pos }) => {
    const flairConfig = player.Flair ? FLAIR_CONFIG[player.Flair] : null;
    const accent = flairConfig?.stroke || BLUE;
    const myGrade = boardMap.get(player.id);
    return ReactDOM.createPortal(
      <div
        style={{
          position: "fixed", top: `${pos.top}px`, left: `${pos.left}px`,
          width: "250px", background: "#fff", border: `2px solid ${accent}`,
          borderRadius: "14px", padding: "14px 16px", boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
          zIndex: 9999, textAlign: "left", pointerEvents: "none",
        }}
      >
        {pos.flip ? (
          <div style={{
            position: "absolute", top: "100%", left: "24px",
            width: "12px", height: "12px", background: "#fff",
            border: `2px solid ${accent}`, borderLeft: "none", borderTop: "none",
            transform: "rotate(45deg)",
          }} />
        ) : (
          <div style={{
            position: "absolute", bottom: "100%", left: "24px",
            width: "12px", height: "12px", background: "#fff",
            border: `2px solid ${accent}`, borderRight: "none", borderBottom: "none",
            transform: "rotate(45deg)",
          }} />
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: flairConfig ? "10px" : "12px" }}>
          {flairConfig && (
            <img src={flairConfig.img} alt={player.Flair} style={{ width: "34px", height: "34px", objectFit: "contain", flexShrink: 0 }} />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: "17px", color: BLUE, lineHeight: 1.15 }}>
              {player.First} {player.Last}
            </div>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#888", marginTop: "2px" }}>
              {player.Position || "—"} · {player.School || "—"}
            </div>
          </div>
        </div>

        {flairConfig && (
          <div style={{ marginBottom: "12px", paddingBottom: "10px", borderBottom: "1px solid #f0f0f0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
              <span style={{ fontSize: "10px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.07em", color: accent }}>
                {player.Flair}
              </span>
              {flairConfig.tag && (
                <span style={{
                  fontSize: "8px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em",
                  color: "#fff", background: accent, padding: "2px 6px", borderRadius: "20px",
                }}>
                  {flairConfig.tag}
                </span>
              )}
            </div>
            <div style={{ fontSize: "11.5px", fontWeight: 600, color: "#666", lineHeight: 1.45 }}>
              {flairConfig.desc}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "10px" }}>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: "9px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>My Grade</div>
            <GradeBadge grade={myGrade} small />
          </div>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: "9px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>Comm Grade</div>
            <GradeBadge grade={player.CommunityGrade} small />
          </div>
        </div>
      </div>,
      document.body
    );
  };

  const [sortKey, setSortKey] = useState("CommunityGrade");
  const [sortOrder, setSortOrder] = useState("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSchools, setSelectedSchools] = useState([]);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [selectedCommGrades, setSelectedCommGrades] = useState([]);
  const [selectedMyGrades, setSelectedMyGrades] = useState([]);
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);

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
      setSortKey("CommunityGrade");
      setSortOrder("asc");
    }
  }, [eligibleYear]);

  // ── Guards against the two sync effects below fighting each other. When
  // the filter-state effect (further down) drops the :position segment
  // because 2+ positions got selected, that URL change would otherwise
  // re-trigger the effect right below it, which — seeing no position in the
  // URL — would wipe the multi-select back to []. This flag marks "this URL
  // change came from our own state, not a real navigation", so the sync-from-
  // URL effect knows to skip re-deriving state that one time. ──
  const programmaticNavRef = useRef(false);

  // ── URL -> filter state: when the :position route param changes (i.e. the
  // user navigated — clicked a link, typed a URL, hit back/forward), sync
  // the position filter to match. Runs after the year-reset effect above, so
  // on a combined year+position navigation (e.g. /community/2028 ->
  // /community/2027/qb) this correctly re-applies the position that the
  // reset effect would otherwise have just cleared. Skips entirely if this
  // URL change was self-inflicted by the state->URL effect below (see
  // programmaticNavRef above) — otherwise a 2+ position multi-select gets
  // wiped the instant it causes the :position segment to drop. ──
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

  // ── Filter state -> URL: when exactly one position is selected (whether
  // from the URL sync above or the visitor clicking a position filter
  // button), make sure the address bar reflects it as a real, shareable,
  // crawlable URL — /community/{year}/{position}. Falls back to the plain
  // year URL when zero or multiple positions are selected, since a
  // multi-position combination isn't a meaningful canonical page. Sets
  // programmaticNavRef before navigating so the effect above knows this
  // particular URL change originated here, not from an actual navigation. ──
  useEffect(() => {
    const currentPos = position ? position.toUpperCase() : null;
    const desiredPos = selectedPositions.length === 1 ? selectedPositions[0] : null;
    if (desiredPos === currentPos) return;
    programmaticNavRef.current = true;
    navigate(yearPath(eligibleYear, desiredPos), { replace: true });
  }, [selectedPositions, eligibleYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const yearPath = (yr, pos) => {
    if (pos) return `/community/${yr}/${pos.toLowerCase()}`;
    return yr === "2027" ? "/community" : `/community/${yr}`;
  };

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

  const [playerCache, setPlayerCache] = useState({});

  useEffect(() => {
    if (playerCache[eligibleYear]) {
      setPlayers(playerCache[eligibleYear]);
      setLoading(false);
      return;
    }

    const isActiveYear = ACTIVE_YEARS.includes(eligibleYear);
    const isArchiveYear = ARCHIVE_YEARS.includes(eligibleYear);
    if (!isActiveYear && !isArchiveYear) return;

    const fetchPlayers = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(query(collection(db, "players"), where("Eligible", "==", eligibleYear)));
        const data = await Promise.all(
          snap.docs
            .filter((docSnap) => docSnap.data().Live !== false)
            .map(async (docSnap) => {
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
        setPlayerCache((prev) => ({ ...prev, [eligibleYear]: data }));
        setPlayers(data);
      } catch (err) {
        console.error("Error fetching players:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchPlayers();
  }, [eligibleYear]);

  useEffect(() => {
    const fetchBoard = async () => {
      if (!user?.uid) { setBoardMap(new Map()); return; }
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

  const resetFilters = () => {
    setSelectedSchools([]); setSelectedPositions([]);
    setSelectedCommGrades([]); setSelectedMyGrades([]);
    setSearchQuery(""); setShowAvailableOnly(false);
    setSortKey("CommunityGrade"); setSortOrder("asc");
  };

  const is2026 = eligibleYear === "2026";
  const is2029Empty = eligibleYear === "2029" && !loading && players.length === 0;

  const filteredPlayers = players
    .filter((p) => !searchQuery.trim() ? true : `${p.First || ""} ${p.Last || ""}`.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    .filter((p) => selectedPositions.length === 0 ? true : selectedPositions.includes(p.Position))
    .filter((p) => selectedSchools.length === 0 ? true : selectedSchools.includes(p.School))
    .filter((p) => selectedCommGrades.length === 0 ? true : selectedCommGrades.includes(p.CommunityGrade))
    .filter((p) => {
      if (selectedMyGrades.length === 0) return true;
      const myGrade = boardMap.get(p.id);
      return myGrade ? selectedMyGrades.includes(myGrade) : false;
    })
    .filter((p) => showAvailableOnly ? !draftMap[p.Slug] : true);

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

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", fontSize: 20, fontWeight: 900, color: BLUE, fontFamily: "'Arial Black', Arial, sans-serif" }}>
      Loading Board...
    </div>
  );

  // ── SEO: page-specific title/description/canonical + Open Graph/Twitter
  // Card tags, mirroring the pattern used on PlayerProfile.js. Built from
  // eligibleYear (and now position) so every combination — 2026 archive,
  // 2027/2028/2029, and each position within each year — gets its own
  // distinct, crawlable metadata instead of one generic page for everything.
  // "2027 NFL Draft Quarterback Rankings" etc. is the whole point: each
  // position gets a real URL + real title, not just a client-side filter. ──
  const positionParam = position ? position.toUpperCase() : null;
  const positionLabel = positionParam ? (POSITION_LABELS[positionParam] || positionParam) : null;

  const pageTitle = positionLabel
    ? `${eligibleYear} NFL Draft ${positionLabel} Rankings | We-Draft.com`
    : `${eligibleYear} NFL Draft Community Board | We-Draft.com`;
  const pageDescription = positionLabel
    ? `We-Draft.com ${eligibleYear} NFL Draft ${positionLabel} rankings. Community grades, strengths, weaknesses, and NFL fit projections for top ${positionLabel.toLowerCase()} prospects — voted on by the community.`
    : `We-Draft.com ${eligibleYear} NFL Draft community scouting board. Player grades, strengths, weaknesses, and NFL fit projections — voted on by the community.`;
  const pageUrl = `https://we-draft.com${yearPath(eligibleYear, positionParam)}`;

  return (
    <>
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


      <div style={{ maxWidth: "1300px", margin: "0 auto", padding: isMobile ? "4px 10px 60px" : "6px 24px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* Page Header */}
        <div style={{ marginBottom: "20px", border: `3px solid ${BLUE}`, borderRadius: "12px", overflow: "hidden" }}>
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
              textShadow: `-1px -1px 0 ${GOLD}, 1px -1px 0 ${GOLD}, -1px 1px 0 ${GOLD}, 1px 1px 0 ${GOLD}, 0 -1px 0 ${GOLD}, 0 1px 0 ${GOLD}, -1px 0 0 ${GOLD}, 1px 0 0 ${GOLD}`,
            }}>
              {positionLabel ? `${eligibleYear} ${positionLabel} Rankings` : `${eligibleYear} Community Board`}
            </h1>
            <div style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 700, color: "rgba(255,255,255,0.75)", letterSpacing: "0.06em", textTransform: "uppercase", textAlign: "center", lineHeight: 1.4, minHeight: isMobile ? "34px" : "20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {positionLabel ? `${eligibleYear} NFL Draft ${positionLabel} Board — We-Draft.com User Grades` : `${eligibleYear} NFL Draft Community Board — We-Draft.com User Grades`}
            </div>
          </div>
          <div style={{ height: "4px", background: GOLD }} />
        </div>

        {/* Year Selector */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
            <ArchiveDropdown eligibleYear={eligibleYear} onSelect={(yr) => navigate(yearPath(yr))} />
            {ACTIVE_YEARS.map((yr) => (
              <Link
                key={yr}
                to={yearPath(yr)}
                style={{
                  border: `3px solid ${GOLD}`, borderRadius: "24px",
                  padding: isMobile ? "10px 26px" : "14px 40px",
                  fontWeight: 900, fontSize: isMobile ? "18px" : "22px",
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

        {!is2029Empty && (
          isMobile ? (
            <PositionFilterBar options={allPositions} selected={selectedPositions} setSelected={setSelectedPositions} isMobile />
          ) : (
            <PositionFilterBar options={allPositions} selected={selectedPositions} setSelected={setSelectedPositions} />
          )
        )}

        {/* 2029 placeholder */}
        {is2029Empty ? (
          <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
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
            {/* Filters */}
            {isMobile ? (
              <div style={{ marginBottom: "12px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "6px" }}>
                  <DropdownChecklist title="School" options={allSchools} selected={selectedSchools} setSelected={setSelectedSchools} />
                  <DropdownChecklist title="My Grade" options={gradeOrder} selected={selectedMyGrades} setSelected={setSelectedMyGrades} ordered />
                  <DropdownChecklist title="Comm Grade" options={commGradeOrder} selected={selectedCommGrades} setSelected={setSelectedCommGrades} ordered />
                </div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center", justifyContent: "center", marginBottom: "6px" }}>
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
                        padding: "8px 12px", fontWeight: 900, fontSize: "12px",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                        border: `2px solid ${GOLD}`, borderRadius: "8px", cursor: "pointer",
                        background: showAvailableOnly ? GOLD : "#fff",
                        color: showAvailableOnly ? "#fff" : BLUE, whiteSpace: "nowrap", flexShrink: 0,
                      }}
                    >
                      {showAvailableOnly ? "✓ Available" : "Available"}
                    </button>
                  )}
                  <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search player..."
                    style={{ flex: 1, minWidth: "140px", border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "8px 12px", fontWeight: 700, fontSize: "13px", color: BLUE, outline: "none" }} />
                  <button onClick={resetFilters} style={{ background: "none", border: "none", color: "#999", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline", flexShrink: 0 }}>Reset</button>
                </div>
              </div>
            ) : (
              <>
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
                        border: `2px solid ${GOLD}`, borderRadius: "8px", cursor: "pointer",
                        background: showAvailableOnly ? GOLD : "#fff",
                        color: showAvailableOnly ? "#fff" : BLUE, whiteSpace: "nowrap",
                      }}
                    >
                      {showAvailableOnly ? "✓ Available" : "Available"}
                    </button>
                  )}
                  <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search player..."
                    style={{ border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "8px 14px", fontWeight: 700, fontSize: "13px", color: BLUE, outline: "none", width: "280px" }} />
                  <button onClick={resetFilters} style={{ background: "none", border: "none", color: "#999", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Reset</button>
                </div>
              </>
            )}

            {/* Table Card */}
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ background: BLUE, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  {selectedPositions.length === 1
                    ? `${eligibleYear} ${POSITION_LABELS[selectedPositions[0]] || selectedPositions[0]} Rankings`
                    : `${eligibleYear} Draft Class`}
                </div>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px", fontWeight: 700 }}>
                  {sortedPlayers.length} player{sortedPlayers.length !== 1 ? "s" : ""}
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
                          <Link
                            to={`/player/${p.Slug}`}
                            style={{ color: BLUE, fontWeight: 900, fontSize: "15px", textDecoration: "none", display: "block", lineHeight: 1.2 }}
                            onMouseEnter={(e) => handlePlayerHoverEnter(p.id, e)}
                            onMouseLeave={handlePlayerHoverLeave}
                          >
                            {`${p.First || ""} ${p.Last || ""}`}
                          </Link>
                          {hoveredPlayerId === p.id && <PlayerPreviewCard player={p} pos={hoverCardPos} />}
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "#555", marginTop: "3px" }}>
                            {p.Position || "—"} · {p.School || "—"}
                          </div>
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
                  {/* Header row — plain clickable labels instead of table <th> cells, since this
                      is a ranked list now, not a spreadsheet grid. SortLabel gives the active
                      column a gold highlight and keeps a faint arrow visible on every column so
                      sortability reads at a glance instead of being invisible until hovered. */}
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
                        background: `linear-gradient(135deg, ${BLUE}, #003d7a)`,
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
                            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; handlePlayerHoverEnter(p.id, e); }}
                            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; handlePlayerHoverLeave(); }}
                          >
                            {`${p.First || ""} ${p.Last || ""}`}
                          </Link>
                          {hoveredPlayerId === p.id && <PlayerPreviewCard player={p} pos={hoverCardPos} />}
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
    </>
  );
}