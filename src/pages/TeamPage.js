import { useEffect, useState, useRef, useMemo } from "react";
import ReactDOM from "react-dom";
import { useParams, Link } from "react-router-dom";
import { collection, getDocs, getDoc, doc, query, where, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const PROSPECT_YEARS = ["2027", "2028", "2029"];
const ARCHIVE_YEAR = "2026";
const NEWS_LIMIT = 8;

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

// ── Shared sidebar card shell ──
function SidebarCard({ title, color1, color2, children, headerRight }) {
  return (
    <div style={{ border: `2px solid ${color1}`, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ backgroundColor: color1, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: "14px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {title}
        </div>
        {headerRight && headerRight}
      </div>
      <div style={{ height: "4px", backgroundColor: color2 }} />
      <div style={{ background: "#fff" }}>{children}</div>
    </div>
  );
}

function GradeBadge({ grade }) {
  const gd = gradeDisplay(grade);
  if (!gd) return null;
  const isFirstRound = ["Early First Round", "Middle First Round", "Late First Round"].includes(grade);
  const qualifier = isFirstRound ? grade.replace(" First Round", "").toUpperCase() : null;
  return (
    <div style={{
      display: "inline-flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", backgroundColor: gd.bg, border: `2px solid ${gd.border}`,
      borderRadius: "5px", width: "52px", height: "42px", flexShrink: 0, gap: "1px",
    }}>
      {qualifier && (
        <span style={{ fontSize: "6.5px", fontWeight: 900, color: "rgba(255,255,255,0.9)", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1 }}>
          {qualifier}
        </span>
      )}
      <span style={{ fontSize: "15px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{gd.short}</span>
      <span style={{ fontSize: "6px", fontWeight: 800, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.05em", lineHeight: 1.1 }}>
        {grade === "UDFA" ? "UDFA" : "ROUND"}
      </span>
    </div>
  );
}

function SectionTitle({ children, color1, color2 }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <div style={{ fontSize: "18px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: color1, marginBottom: "5px" }}>
        {children}
      </div>
      <div style={{ height: "3px", background: color1, borderRadius: "2px", marginBottom: "3px" }} />
      <div style={{ height: "3px", background: color2, borderRadius: "2px" }} />
    </div>
  );
}

// ── NFL full name → abbreviation map (for historical collection lookup) ──
const NFL_NAME_TO_ABBR = {
  "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
  "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LAR", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
  "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
  "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
};

// ── Shared column widths — single source of truth ──
const COL = {
  year:  { width: "52px" },
  round: { width: "44px" },
  pick:  { width: "44px" },
  pos:   { width: "52px" },
  nfl:   { width: "36px" },
  grade: { width: "58px" },
  arrow: { width: "20px" },
};

// ── Sticky column header row ──
function TableHeader({ color1, color2, isMobile, showDraftPick, showGrade, showNfl = true }) {
  const cell = (label, width) => (
    <div style={{
      flexShrink: 0, width,
      fontSize: "11px", fontWeight: 900, color: "#fff",
      textTransform: "uppercase", letterSpacing: "0.1em", textAlign: "center",
    }}>
      {label}
    </div>
  );
  const gradeWidth = isMobile ? "52px" : "80px";
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 10,
      display: "flex", alignItems: "center", gap: isMobile ? "6px" : "10px",
      padding: isMobile ? "7px 10px" : "9px 18px",
      background: `${color1}f5`, borderBottom: `3px solid ${color2}`,
      backdropFilter: "blur(4px)",
    }}>
      {cell("Year", COL.year.width)}
      {showDraftPick && cell("Rd", COL.round.width)}
      {showDraftPick && !isMobile && cell("Pick", COL.pick.width)}
      {cell("Pos", COL.pos.width)}
      {showNfl && !isMobile && cell("NFL", COL.nfl.width)}
      <div style={{ flex: 1, minWidth: 0, fontSize: "11px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.1em" }}>
        Player
      </div>
      {showGrade && (
        <div style={{ flexShrink: 0, width: gradeWidth, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "2px" }}>
          <div style={{ fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", lineHeight: 1, whiteSpace: "nowrap" }}>We-Draft</div>
          <div style={{ fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", lineHeight: 1, whiteSpace: "nowrap" }}>Grade</div>
        </div>
      )}
      <div style={{ width: COL.arrow.width, flexShrink: 0 }} />
    </div>
  );
}

function PlayerRow({ player, commGrade, draftInfo, nflTeams, isMobile, color1, color2, showDraftPick = false, showNfl = true }) {
  const draft = draftInfo;
  const teamData = draft ? nflTeams[draft.team] : null;

  return (
    <Link
      to={`/player/${player.Slug}`}
      style={{
        display: "flex", alignItems: "center", gap: isMobile ? "6px" : "10px",
        padding: isMobile ? "10px 12px" : "12px 18px", textDecoration: "none",
        background: "#fff", borderBottom: "1px solid #f0f0f0", transition: "background 0.12s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
    >
      <div style={{ flexShrink: 0, width: COL.year.width, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 900, color: "#444", lineHeight: 1 }}>
          {player.Eligible ? String(player.Eligible).replace(/s$/i, "") : "—"}
        </span>
      </div>

      {showDraftPick && (
        <div style={{ flexShrink: 0, width: COL.round.width, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {draft ? (
            <div style={{
              width: "38px", height: "38px", borderRadius: "6px",
              background: BLUE, border: `2px solid ${GOLD}`,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ fontSize: "7px", fontWeight: 900, color: "rgba(255,255,255,0.7)", lineHeight: 1 }}>Rd</span>
              <span style={{ fontSize: "16px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{draft.round}</span>
            </div>
          ) : <span style={{ color: "#ddd", fontSize: "12px" }}>—</span>}
        </div>
      )}

      {/* Hide Pick on mobile — saves ~44px of precious row width */}
      {showDraftPick && !isMobile && (
        <div style={{ flexShrink: 0, width: COL.pick.width, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {draft ? (
            <>
              <span style={{ fontSize: "15px", fontWeight: 900, color: "#222", lineHeight: 1 }}>{draft.pick}</span>
              <span style={{ fontSize: "8px", fontWeight: 700, color: "#bbb", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "1px" }}>Pick</span>
            </>
          ) : <span style={{ color: "#ddd", fontSize: "12px" }}>—</span>}
        </div>
      )}

      <div style={{ flexShrink: 0, width: COL.pos.width, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {player.Position ? (
          <span style={{
            background: color1, color: "#fff",
            fontSize: isMobile ? "10px" : "11px", fontWeight: 900,
            padding: isMobile ? "3px 5px" : "4px 6px", borderRadius: "4px",
            textTransform: "uppercase", letterSpacing: "0.03em",
            display: "block", textAlign: "center", width: "100%",
          }}>
            {player.Position}
          </span>
        ) : <span style={{ color: "#ddd", fontSize: "12px" }}>—</span>}
      </div>

      {showNfl && !isMobile && (
        <div style={{ flexShrink: 0, width: COL.nfl.width, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {teamData?.Logo1 ? (
            <div style={{ width: "32px", height: "32px", background: "#f5f5f5", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", padding: "2px" }}>
              <img src={sanitizeUrl(teamData.Logo1)} alt={draft?.team}
                style={{ width: "28px", height: "28px", objectFit: "contain" }}
                onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }} />
            </div>
          ) : <div style={{ width: "32px" }} />}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 900, fontSize: isMobile ? "15px" : "20px", color: color1,
          lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {`${player.First || ""} ${player.Last || ""}`}
        </div>
      </div>

      <div style={{ flexShrink: 0, width: isMobile ? "52px" : "80px", height: "42px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {commGrade ? <GradeBadge grade={commGrade} /> : null}
      </div>

      <span style={{ color: "#ccc", fontSize: "16px", fontWeight: 900, flexShrink: 0, width: COL.arrow.width, textAlign: "center" }}>›</span>
    </Link>
  );
}

function HistoricalRow({ player, nflTeams, isMobile, color1, color2 }) {
  const nflTeamName = player["NFL Team"] || "";
  const abbr = NFL_NAME_TO_ABBR[nflTeamName];
  const nflEntry = abbr ? nflTeams[abbr] : null;
  const teamLogo = nflEntry?.Logo1 || null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: isMobile ? "6px" : "10px",
      padding: isMobile ? "10px 12px" : "12px 18px",
      background: "#fff", borderBottom: "1px solid #f0f0f0",
    }}>
      <div style={{ flexShrink: 0, width: COL.year.width, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 900, color: "#444", lineHeight: 1 }}>{player.Year || "—"}</span>
      </div>

      <div style={{ flexShrink: 0, width: COL.round.width, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          width: "38px", height: "38px", borderRadius: "6px",
          background: BLUE, border: `2px solid ${GOLD}`,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: "7px", fontWeight: 900, color: "rgba(255,255,255,0.7)", lineHeight: 1 }}>Rd</span>
          <span style={{ fontSize: "16px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{player.Round}</span>
        </div>
      </div>

      {/* Hide Pick on mobile — saves ~44px */}
      {!isMobile && (
        <div style={{ flexShrink: 0, width: COL.pick.width, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "15px", fontWeight: 900, color: "#222", lineHeight: 1 }}>{player.Pick}</span>
          <span style={{ fontSize: "8px", fontWeight: 700, color: "#bbb", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "1px" }}>Pick</span>
        </div>
      )}

      <div style={{ flexShrink: 0, width: COL.pos.width, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {player.Position ? (
          <span style={{
            background: color1, color: "#fff",
            fontSize: isMobile ? "10px" : "11px", fontWeight: 900,
            padding: isMobile ? "3px 5px" : "4px 6px", borderRadius: "4px",
            textTransform: "uppercase", letterSpacing: "0.03em",
            display: "block", textAlign: "center", width: "100%",
          }}>
            {player.Position}
          </span>
        ) : <span style={{ color: "#ddd", fontSize: "12px" }}>—</span>}
      </div>

      {!isMobile && (
        <div style={{ flexShrink: 0, width: COL.nfl.width, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {teamLogo ? (
            <div style={{ width: "32px", height: "32px", background: "#f5f5f5", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", padding: "2px" }}>
              <img src={sanitizeUrl(teamLogo)} alt={nflTeamName}
                style={{ width: "28px", height: "28px", objectFit: "contain" }}
                onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }} />
            </div>
          ) : <div style={{ width: "32px" }} />}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 900, fontSize: isMobile ? "15px" : "20px", color: "#333",
          lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {player.Player || "—"}
        </div>
      </div>

      {/* Grade slot — sized to match PlayerRow */}
      <div style={{ flexShrink: 0, width: isMobile ? "52px" : "80px", height: "42px" }} />
      <div style={{ flexShrink: 0, width: COL.arrow.width }} />
    </div>
  );
}

// ── FilterButton — renders dropdown via portal to escape overflow:hidden ancestors ──
function FilterButton({ label, options, panelKey, activeSet, onToggle, onClearGroup, color1, color2, openPanel, setOpenPanel }) {
  const isOpen = openPanel === panelKey;
  const hasActive = activeSet.size > 0;
  const btnRef = useRef(null);
  const [dropdownStyle, setDropdownStyle] = useState({});

  // Recompute dropdown position whenever it opens
  useEffect(() => {
    if (isOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left: rect.left,
        zIndex: 99999,
        background: "#fff",
        border: `2px solid ${color1}`,
        borderRadius: "8px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
        minWidth: "160px",
        overflow: "hidden",
      });
    }
  }, [isOpen, color1]);

  const handleOpen = () => {
    setOpenPanel(isOpen ? null : panelKey);
  };

  const dropdown = isOpen ? ReactDOM.createPortal(
    <div style={dropdownStyle}>
      <div style={{ background: color1, padding: "6px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
        {activeSet.size > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onClearGroup(panelKey); }}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "10px", cursor: "pointer", fontWeight: 700 }}
          >
            Clear
          </button>
        )}
      </div>
      <div style={{ height: "2px", background: color2 }} />
      <div style={{ maxHeight: "220px", overflowY: "auto" }}>
        {options.map((val) => {
          const checked = activeSet.has(val);
          return (
            <label
              key={val}
              onClick={() => onToggle(panelKey, val)}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "8px 12px", cursor: "pointer",
                borderBottom: "1px solid #f0f0f0",
                background: checked ? `${color1}0d` : "#fff",
                transition: "background 0.1s",
              }}
            >
              <div style={{
                width: "16px", height: "16px", borderRadius: "3px", flexShrink: 0,
                border: `2px solid ${checked ? color1 : "#ccc"}`,
                background: checked ? color1 : "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {checked && <span style={{ color: "#fff", fontSize: "10px", fontWeight: 900, lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ fontSize: "12px", fontWeight: 800, color: "#333", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {panelKey === "round" ? `Round ${val}` : val}
              </span>
            </label>
          );
        })}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        style={{
          display: "flex", alignItems: "center", gap: "5px",
          border: `2px solid ${hasActive ? color1 : "#d0d0d0"}`,
          borderRadius: "6px", padding: "5px 10px",
          fontWeight: 900, fontSize: "11px",
          color: hasActive ? color1 : "#666",
          background: hasActive ? `${color1}10` : "#fff",
          cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        {hasActive && (
          <span style={{
            background: color1, color: "#fff", borderRadius: "10px",
            padding: "1px 6px", fontSize: "10px", fontWeight: 900,
          }}>
            {activeSet.size}
          </span>
        )}
        <span style={{ fontSize: "8px", color: "#aaa", marginLeft: "2px" }}>{isOpen ? "▲" : "▼"}</span>
      </button>
      {dropdown}
    </div>
  );
}

// ── Archive filter bar + filtered list ──
function ArchiveFilters({ allYears, allRounds, allPositions, allArchive, color1, color2, isMobile, nflTeams }) {
  const [selectedYears, setSelectedYears] = useState(new Set());
  const [selectedRounds, setSelectedRounds] = useState(new Set());
  const [selectedPositions, setSelectedPositions] = useState(new Set());
  const [openPanel, setOpenPanel] = useState(null);

  const handleToggle = (panelKey, val) => {
    if (panelKey === "year") {
      setSelectedYears((prev) => { const n = new Set(prev); n.has(val) ? n.delete(val) : n.add(val); return n; });
    } else if (panelKey === "round") {
      setSelectedRounds((prev) => { const n = new Set(prev); n.has(val) ? n.delete(val) : n.add(val); return n; });
    } else {
      setSelectedPositions((prev) => { const n = new Set(prev); n.has(val) ? n.delete(val) : n.add(val); return n; });
    }
  };

  const handleClearGroup = (panelKey) => {
    if (panelKey === "year") setSelectedYears(new Set());
    else if (panelKey === "round") setSelectedRounds(new Set());
    else setSelectedPositions(new Set());
  };

  const clearAll = () => {
    setSelectedYears(new Set());
    setSelectedRounds(new Set());
    setSelectedPositions(new Set());
    setOpenPanel(null);
  };

  const hasFilters = selectedYears.size > 0 || selectedRounds.size > 0 || selectedPositions.size > 0;

  const filtered = allArchive.filter((e) => {
    const year = e._year;
    const round = e._type === "player" ? parseInt(e.draftInfo?.round) : parseInt(e.player.Round);
    const pos = e._type === "player" ? e.player.Position : e.player.Position;
    if (selectedYears.size > 0 && !selectedYears.has(year)) return false;
    if (selectedRounds.size > 0 && !selectedRounds.has(round)) return false;
    if (selectedPositions.size > 0 && !selectedPositions.has(pos)) return false;
    return true;
  });

  const sharedFilterProps = { color1, color2, openPanel, setOpenPanel };

  return (
    <>
      {/* Click/touch-outside overlay to close panels (touchStart covers iOS) */}
      {openPanel && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 99 }}
          onClick={() => setOpenPanel(null)}
          onTouchStart={() => setOpenPanel(null)}
        />
      )}

      {/* Filter bar — z-index above overlay so buttons are clickable */}
      <div style={{
        display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
        padding: isMobile ? "10px 12px" : "10px 18px",
        background: "#f7f8fa", borderBottom: "1px solid #e8e8e8",
        position: "relative", zIndex: 100,
      }}>
        <span style={{ fontSize: "11px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>
          Filter:
        </span>

        <FilterButton
          label="Year" options={allYears} panelKey="year" activeSet={selectedYears}
          onToggle={handleToggle} onClearGroup={handleClearGroup}
          {...sharedFilterProps}
        />
        <FilterButton
          label="Round" options={allRounds} panelKey="round" activeSet={selectedRounds}
          onToggle={handleToggle} onClearGroup={handleClearGroup}
          {...sharedFilterProps}
        />
        <FilterButton
          label="Position" options={allPositions} panelKey="pos" activeSet={selectedPositions}
          onToggle={handleToggle} onClearGroup={handleClearGroup}
          {...sharedFilterProps}
        />

        {hasFilters && (
          <button onClick={clearAll} style={{
            border: "2px solid #ccc", borderRadius: "6px", padding: "5px 12px",
            fontWeight: 900, fontSize: "11px", color: "#888", background: "#fff",
            cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            Clear All
          </button>
        )}

        <span style={{ marginLeft: isMobile ? "0" : "auto", width: isMobile ? "100%" : "auto", fontSize: "11px", fontWeight: 700, color: "#aaa" }}>
          {filtered.length} player{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Rows */}
      {filtered.length === 0 ? (
        <div style={{ padding: "40px 24px", textAlign: "center", background: "#fff" }}>
          <div style={{ fontSize: "32px", marginBottom: "10px" }}>🔍</div>
          <div style={{ fontSize: "15px", fontWeight: 900, color: color1, textTransform: "uppercase", letterSpacing: "0.06em" }}>No results</div>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#888", marginTop: "6px" }}>Try adjusting your filters.</div>
        </div>
      ) : (
        <>
          <TableHeader color1={color1} color2={color2} isMobile={isMobile} showDraftPick={true} showGrade={true} showNfl={true} />
          {filtered.map((entry) => {
            if (entry._type === "historical") {
              return (
                <HistoricalRow key={entry._key} player={entry.player}
                  nflTeams={nflTeams} isMobile={isMobile} color1={color1} color2={color2} />
              );
            }
            return (
              <PlayerRow key={entry._key} player={entry.player}
                commGrade={entry.player.commGrade}
                draftInfo={entry.draftInfo?.team ? entry.draftInfo : null}
                nflTeams={nflTeams} isMobile={isMobile}
                color1={color1} color2={color2} showDraftPick={true} showNfl={true} />
            );
          })}
        </>
      )}
    </>
  );
}

// ── Main tabs + player lists ──
function MainContent({
  school, canonicalSchool, color1, color2, isMobile,
  activeTab, setActiveTab, prospects, archivePlayers, historicalPlayers,
  draftMap, nflTeams, totalProspects,
}) {
  const totalArchive = archivePlayers.length + historicalPlayers.length;

  // Memoize so this only rebuilds when source data changes, not on every filter re-render
  const allArchive = useMemo(() => {
    const raw = [
      ...archivePlayers.map((p) => {
        const draftInfo = draftMap[p.Slug] || {};
        return { _type: "player", _year: 2026, _pick: parseInt(draftInfo.pick) || 9999, _key: `player-${p.Slug}`, player: p, draftInfo };
      }),
      ...historicalPlayers.map((h) => ({
        _type: "historical", _year: parseInt(h.Year) || 0, _pick: parseInt(h.Pick) || 9999, _key: `hist-${h.Year}-${h.Pick}-${h.Player}`, player: h,
      })),
    ].sort((a, b) => {
      if (a._year === b._year && a._pick === b._pick) {
        if (a._type === "player" && b._type !== "player") return -1;
        if (b._type === "player" && a._type !== "player") return 1;
      }
      return b._year - a._year || a._pick - b._pick;
    });

    // Dedup: player entries by Slug, historical by year+pick and year+name
    const seenSlugs = new Set();
    const seenPickKeys = new Set();
    const seenNameKeys = new Set();

    return raw.filter((e) => {
      if (e._type === "player") {
        const slug = e.player.Slug;
        if (!slug || seenSlugs.has(slug)) return false;
        seenSlugs.add(slug);
        return true;
      } else {
        const pick = parseInt(e._pick);
        const year = parseInt(e._year);
        if (pick && pick !== 9999) {
          const pickKey = `${year}-${pick}`;
          if (seenPickKeys.has(pickKey)) return false;
          seenPickKeys.add(pickKey);
        }
        const name = (e.player.Player || "").trim().toLowerCase();
        if (name) {
          const nameKey = `${year}-${name}`;
          if (seenNameKeys.has(nameKey)) return false;
          seenNameKeys.add(nameKey);
        }
        return true;
      }
    });
  }, [archivePlayers, historicalPlayers, draftMap]);

  return (
    <div>
      {/* Tab nav */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "20px", flexWrap: "wrap" }}>
        <button onClick={() => setActiveTab("prospects")} style={{
          padding: isMobile ? "7px 18px" : "8px 24px", fontWeight: 900,
          fontSize: isMobile ? "13px" : "14px", textTransform: "uppercase", letterSpacing: "0.06em",
          border: `2px solid ${color2}`, borderRadius: "8px", cursor: "pointer",
          background: activeTab === "prospects" ? color1 : "#fff",
          color: activeTab === "prospects" ? "#fff" : color1,
        }}>
          Prospects ({totalProspects})
        </button>
        <button onClick={() => setActiveTab("archive")} style={{
          padding: isMobile ? "7px 18px" : "8px 24px", fontWeight: 900,
          fontSize: isMobile ? "13px" : "14px", textTransform: "uppercase", letterSpacing: "0.06em",
          border: `2px solid ${color2}`, borderRadius: "8px", cursor: "pointer",
          background: activeTab === "archive" ? color1 : "#fff",
          color: activeTab === "archive" ? "#fff" : color1,
        }}>
          Archive ({totalArchive})
        </button>
      </div>

      {/* ── PROSPECTS TAB ── */}
      {activeTab === "prospects" && (() => {
        const allProspects = PROSPECT_YEARS.flatMap((yr) => prospects[yr] || [])
          .sort((a, b) => {
            const aScore = a.commGradeScore ?? 999;
            const bScore = b.commGradeScore ?? 999;
            if (aScore !== bScore) return aScore - bScore;
            return (a.Eligible || "").localeCompare(b.Eligible || "");
          });
        return (
          <div style={{ border: `2px solid ${color1}`, borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ background: color1, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? "13px" : "15px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                We-Draft Prospects ({allProspects.length})
              </div>
              <Link to="/community" style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 800, textDecoration: "underline" }}>
                Full Board →
              </Link>
            </div>
            <div style={{ height: "3px", background: color2 }} />
            {allProspects.length === 0 ? (
              <div style={{ padding: "40px 24px", textAlign: "center", background: "#fff" }}>
                <div style={{ fontSize: "32px", marginBottom: "10px" }}>🏈</div>
                <div style={{ fontSize: "16px", fontWeight: 900, color: color1, textTransform: "uppercase", letterSpacing: "0.06em" }}>No We-Draft prospects yet</div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#888", marginTop: "6px" }}>No 2027–2029 players from {canonicalSchool} in the We-Draft database yet.</div>
              </div>
            ) : (
              <>
                <TableHeader color1={color1} color2={color2} isMobile={isMobile} showDraftPick={false} showGrade={true} showNfl={false} />
                {allProspects.map((p) => (
                  <PlayerRow key={p.id} player={p} commGrade={p.commGrade}
                    draftInfo={null} nflTeams={nflTeams} isMobile={isMobile}
                    color1={color1} color2={color2} showDraftPick={false} showNfl={false} />
                ))}
              </>
            )}
          </div>
        );
      })()}

      {/* ── ARCHIVE TAB ── */}
      {activeTab === "archive" && (() => {
        const allYears = [...new Set(allArchive.map((e) => e._year))].sort((a, b) => b - a);
        const allRounds = [...new Set(allArchive.map((e) => {
          const r = e._type === "player" ? e.draftInfo?.round : e.player.Round;
          return r ? parseInt(r) : null;
        }).filter(Boolean))].sort((a, b) => a - b);
        const allPositions = [...new Set(allArchive.map((e) => {
          return e._type === "player" ? e.player.Position : e.player.Position;
        }).filter(Boolean))].sort((a, b) => {
          const POS_ORDER = ["QB","RB","WR","TE","OL","EDGE","DL","LB","DB","K","P","LS"];
          const ai = POS_ORDER.indexOf(a), bi = POS_ORDER.indexOf(b);
          if (ai !== -1 && bi !== -1) return ai - bi;
          if (ai !== -1) return -1; if (bi !== -1) return 1;
          return a.localeCompare(b);
        });

        return (
          <div style={{ border: `2px solid ${color1}`, borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ background: color1, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? "13px" : "15px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  NFL Draft History ({totalArchive})
                </div>
                <div style={{ color: "rgba(255,255,255,0.65)", fontWeight: 700, fontSize: "10px", marginTop: "2px" }}>
                  Data available back to 2000
                </div>
              </div>
              <Link to="/community/2026" style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 800, textDecoration: "underline", flexShrink: 0, marginLeft: "12px" }}>
                2026 Board →
              </Link>
            </div>
            <div style={{ height: "3px", background: color2 }} />
            <ArchiveFilters
              allYears={allYears} allRounds={allRounds} allPositions={allPositions}
              allArchive={allArchive} color1={color1} color2={color2} isMobile={isMobile}
              nflTeams={nflTeams}
            />
          </div>
        );
      })()}
    </div>
  );
}

export default function TeamPage() {
  const { teamId: slug } = useParams();
  const [school, setSchool] = useState(null);
  const [branding, setBranding] = useState(null);
  const [prospects, setProspects] = useState({});
  const [archivePlayers, setArchivePlayers] = useState([]);
  const [historicalPlayers, setHistoricalPlayers] = useState([]);
  const [draftMap, setDraftMap] = useState({});
  const [nflTeams, setNflTeams] = useState({});
  const [loading, setLoading] = useState(true);
  const [canonicalSchool, setCanonicalSchool] = useState("");
  const [activeTab, setActiveTab] = useState("prospects");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  const [conferenceTeams, setConferenceTeams] = useState([]);
  const [teamNews, setTeamNews] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [schoolsMap, setSchoolsMap] = useState({});

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const slugFallback = slug
    ? slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").replace(/\bAnd\b/g, "&")
    : "";

  useEffect(() => {
    const load = async () => {
      try {
        let schoolData = null;
        const slugQuery = await getDocs(query(collection(db, "schools"), where("Slug", "==", slug)));
        if (!slugQuery.empty) {
          schoolData = slugQuery.docs[0].data();
        } else {
          const directSnap = await getDoc(doc(db, "schools", slugFallback));
          if (directSnap.exists()) schoolData = directSnap.data();
        }

        if (schoolData) {
          setSchool(schoolData);
          setBranding({
            color1: schoolData.Color1 || BLUE,
            color2: schoolData.Color2 || GOLD,
            logo1: schoolData.Logo1 || "",
            logo2: schoolData.Logo2 || "",
            depthChart: schoolData.DepthChart || "",
          });
        } else {
          setBranding({ color1: BLUE, color2: GOLD, logo1: "", logo2: "", depthChart: "" });
        }

        const resolvedSchool = schoolData?.School || slugFallback;
        setCanonicalSchool(resolvedSchool);

        if (schoolData?.Conference) {
          const confSnap = await getDocs(query(
            collection(db, "schools"),
            where("Conference", "==", schoolData.Conference)
          ));
          const confTeams = confSnap.docs
            .map((d) => d.data())
            .sort((a, b) => a.School.localeCompare(b.School));
          setConferenceTeams(confTeams);
        }

        try {
          const [newsSnap, articleSnap] = await Promise.all([
            getDocs(query(collection(db, "news"), where("active", "==", true), where("slugs", "array-contains", slug), orderBy("publishedAt", "desc"), limit(NEWS_LIMIT))),
            getDocs(query(collection(db, "articles"), where("status", "==", "published"), where("slugs", "array-contains", slug), orderBy("publishedAt", "desc"), limit(NEWS_LIMIT))),
          ]);
          const combined = [
            ...newsSnap.docs.map((d) => ({ id: d.id, type: "news", ...d.data() })),
            ...articleSnap.docs.map((d) => ({ id: d.id, type: "article", ...d.data() })),
          ].sort((a, b) => (b.publishedAt?.toMillis?.() || 0) - (a.publishedAt?.toMillis?.() || 0))
            .slice(0, NEWS_LIMIT);
          setTeamNews(combined);
        } catch { setTeamNews([]); }

        const nflSnap = await getDocs(collection(db, "nfl"));
        const nflMap = {};
        nflSnap.docs.forEach((d) => { nflMap[d.id] = d.data(); });
        setNflTeams(nflMap);

        // Full schools map — used to resolve schedule opponents (needed regardless
        // of which conference they're in, unlike the conference-scoped query above)
        try {
          const allSchoolsSnap = await getDocs(collection(db, "schools"));
          const allSchoolsMap = {};
          allSchoolsSnap.docs.forEach((d) => {
            const data = d.data();
            if (data.School) allSchoolsMap[data.School] = data;
          });
          setSchoolsMap(allSchoolsMap);
        } catch {
          setSchoolsMap({});
        }

        const draftSnap = await getDocs(collection(db, "draftOrder"));
        const dMap = {};
        draftSnap.docs.forEach((d) => {
          const data = d.data();
          if (data.Selection) dMap[data.Selection] = { team: data.Team, round: data.Round, pick: data.Pick };
        });
        setDraftMap(dMap);

        // Schedule — a team can appear as either Away or Home, so run both queries and merge
        try {
          const [awaySnap, homeSnap] = await Promise.all([
            getDocs(query(collection(db, "schedule26"), where("Away", "==", resolvedSchool))),
            getDocs(query(collection(db, "schedule26"), where("Home", "==", resolvedSchool))),
          ]);
          const seenIds = new Set();
          const games = [...awaySnap.docs, ...homeSnap.docs]
            .filter((d) => { if (seenIds.has(d.id)) return false; seenIds.add(d.id); return true; })
            .map((d) => ({ id: d.id, ...d.data() }));

          const getGameTime = (g) => {
            if (g.Date?.toDate) return g.Date.toDate().getTime();
            if (g.Date) { const t = new Date(g.Date).getTime(); if (!isNaN(t)) return t; }
            return 0;
          };
          games.sort((a, b) => getGameTime(a) - getGameTime(b));

          setSchedule(games);
        } catch (e) {
          console.error("Schedule load error:", e);
          setSchedule([]);
        }

        const prospectResults = {};
        await Promise.all(
          PROSPECT_YEARS.map(async (yr) => {
            const snap = await getDocs(query(
              collection(db, "players"),
              where("School", "==", resolvedSchool),
              where("Eligible", "==", yr)
            ));
            // Dedup by Slug — multiple sheet rows can produce duplicate Firestore docs
            const seenProspectSlugs = new Set();
            const dedupedDocs = snap.docs.filter((docSnap) => {
              const slug = docSnap.data().Slug;
              if (!slug || seenProspectSlugs.has(slug)) return false;
              seenProspectSlugs.add(slug);
              return true;
            });
            const players = await Promise.all(
              dedupedDocs.map(async (docSnap) => {
                const p = { id: docSnap.id, ...docSnap.data() };
                try {
                  const evalsSnap = await getDocs(collection(db, "players", docSnap.id, "evaluations"));
                  const grades = [];
                  evalsSnap.forEach((e) => {
                    const g = e.data().grade;
                    if (g && gradeScale[g]) grades.push(gradeScale[g]);
                  });
                  p.commGrade = grades.length > 0
                    ? gradeLabels[Math.round(grades.reduce((a, b) => a + b, 0) / grades.length)]
                    : null;
                  p.commGradeScore = grades.length > 0
                    ? grades.reduce((a, b) => a + b, 0) / grades.length
                    : 999;
                } catch {
                  p.commGrade = null;
                  p.commGradeScore = 999;
                }
                return p;
              })
            );
            players.sort((a, b) => a.commGradeScore - b.commGradeScore);
            prospectResults[yr] = players;
          })
        );
        setProspects(prospectResults);

        const archiveSnap = await getDocs(query(
          collection(db, "players"),
          where("School", "==", resolvedSchool),
          where("Eligible", "==", ARCHIVE_YEAR)
        ));

        // Dedup by Slug first — multiple sheet rows can produce multiple Firestore docs
        // with the same Slug. Keep only the first doc per Slug.
        const seenSlugs = new Set();
        const dedupedArchiveDocs = archiveSnap.docs.filter((docSnap) => {
          const slug = docSnap.data().Slug;
          if (!slug || seenSlugs.has(slug)) return false;
          seenSlugs.add(slug);
          return true;
        });

        const archivePlrs = await Promise.all(
          dedupedArchiveDocs
            .filter((docSnap) => !!dMap[docSnap.data().Slug])
            .map(async (docSnap) => {
              const p = { id: docSnap.id, ...docSnap.data() };
              try {
                const evalsSnap = await getDocs(collection(db, "players", docSnap.id, "evaluations"));
                const grades = [];
                evalsSnap.forEach((e) => {
                  const g = e.data().grade;
                  if (g && gradeScale[g]) grades.push(gradeScale[g]);
                });
                p.commGrade = grades.length > 0
                  ? gradeLabels[Math.round(grades.reduce((a, b) => a + b, 0) / grades.length)]
                  : null;
              } catch {
                p.commGrade = null;
              }
              return p;
            })
        );
        archivePlrs.sort((a, b) => {
          const aDraft = dMap[a.Slug];
          const bDraft = dMap[b.Slug];
          return (aDraft?.pick || 9999) - (bDraft?.pick || 9999);
        });
        setArchivePlayers(archivePlrs);

        try {
          const histSnap = await getDocs(query(
            collection(db, "historical"),
            where("School", "==", resolvedSchool)
          ));
          const histRaw = histSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((h) => h.Year && parseInt(h.Year) <= 2025)
            .sort((a, b) => {
              if (b.Year !== a.Year) return parseInt(b.Year) - parseInt(a.Year);
              return parseInt(a.Pick || 999) - parseInt(b.Pick || 999);
            });

          // Dedup by year+pick, then year+name — duplicate rows in Firestore
          // come from multiple sheet rows for the same player
          const hSeenPick = new Set();
          const hSeenName = new Set();
          const histPlayers = histRaw.filter((h) => {
            const year = parseInt(h.Year);
            const pick = parseInt(h.Pick);
            if (pick && pick !== 999) {
              const pickKey = `${year}-${pick}`;
              if (hSeenPick.has(pickKey)) return false;
              hSeenPick.add(pickKey);
            }
            const name = (h.Player || "").trim().toLowerCase();
            if (name) {
              const nameKey = `${year}-${name}`;
              if (hSeenName.has(nameKey)) return false;
              hSeenName.add(nameKey);
            }
            return true;
          });

          setHistoricalPlayers(histPlayers);
        } catch (e) {
          console.error("Historical load error:", e);
          setHistoricalPlayers([]);
        }

      } catch (err) {
        console.error("TeamPage load error:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [slug]);

  const color1 = branding?.color1 || BLUE;
  const color2 = branding?.color2 || GOLD;
  const totalProspects = PROSPECT_YEARS.reduce((acc, yr) => acc + (prospects[yr]?.length || 0), 0);

  if (loading) return (
    <div style={{
      display: "flex", justifyContent: "center", alignItems: "center",
      height: "60vh", fontSize: "18px", fontWeight: 900, color: BLUE,
      fontFamily: "'Arial Black', Arial, sans-serif",
    }}>
      Loading...
    </div>
  );

  const pageTitle = school?.Mascot
    ? `${canonicalSchool} ${school.Mascot} Draft Prospects | We-Draft.com`
    : `${canonicalSchool} Draft Prospects | We-Draft.com`;

  const pageDescription = `View ${canonicalSchool}'s NFL Draft prospects. View draft history, write player evaluations, and create your own draft board on We-Draft.com.`;

  const ConferenceSidebar = (
    <SidebarCard
      title={school?.Conference || "Conference"}
      color1={BLUE} color2={GOLD}
      headerRight={
        <Link to="/cfb" style={{ color: GOLD, fontSize: "11px", fontWeight: 900, textDecoration: "none", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          More →
        </Link>
      }
    >
      {conferenceTeams.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "#999", fontSize: "13px", fontStyle: "italic" }}>No other teams.</div>
      ) : (
        conferenceTeams.map((team, i) => {
          const isSelf = team.School === canonicalSchool;
          const rowStyle = {
            display: "flex", alignItems: "center", gap: "10px", padding: "9px 12px",
            textDecoration: "none",
            background: isSelf ? "#fff8e6" : "#fff",
            borderLeft: isSelf ? `4px solid ${GOLD}` : "4px solid transparent",
            borderBottom: i < conferenceTeams.length - 1 ? "1px solid #f0f0f0" : "none",
            transition: "background 0.12s",
          };
          const rowContent = (
            <>
              {team.Logo1 ? (
                <div style={{
                  width: "28px", height: "28px", flexShrink: 0, display: "flex",
                  alignItems: "center", justifyContent: "center",
                  background: "#f5f5f5", borderRadius: "4px", padding: "2px",
                }}>
                  <img
                    src={sanitizeUrl(team.Logo1)}
                    alt={team.School}
                    style={{ width: "24px", height: "24px", objectFit: "contain" }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                </div>
              ) : (
                <div style={{
                  width: "28px", height: "28px", flexShrink: 0, borderRadius: "4px",
                  background: team.Color1 || BLUE, display: "flex", alignItems: "center",
                  justifyContent: "center", color: "#fff", fontSize: "10px", fontWeight: 900,
                }}>
                  {team.School.charAt(0)}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 900, fontSize: "13px", color: BLUE, lineHeight: 1.2,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {team.School}
                </div>
                {team.Mascot && (
                  <div style={{ fontSize: "10px", fontWeight: 700, color: "#888", lineHeight: 1.2 }}>
                    {team.Mascot}
                  </div>
                )}
              </div>
              {!isSelf && <span style={{ color: "#ccc", fontSize: "14px", fontWeight: 900, flexShrink: 0 }}>›</span>}
            </>
          );
          return isSelf ? (
            <div key={team.Slug || team.School} style={rowStyle}>{rowContent}</div>
          ) : (
            <Link
              key={team.Slug || team.School}
              to={`/team/${team.Slug}`}
              style={rowStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              {rowContent}
            </Link>
          );
        })
      )}
    </SidebarCard>
  );

  // ── Schedule sidebar — opponents are clickable only if they belong to a
  // tracked conference (Independent counts as a conference; unlisted/FCS
  // opponents with no Conference field are shown as plain text). Only the
  // opponent's name is a link for now — full game pages come later.
  let scheduleWins = 0, scheduleLosses = 0, scheduleTies = 0;
  schedule.forEach((g) => {
    const hasScoreG = g.AwayScore !== undefined && g.AwayScore !== null
      && g.HomeScore !== undefined && g.HomeScore !== null;
    if (!hasScoreG) return;
    const isHome = g.Home === canonicalSchool;
    const ownScore = isHome ? g.HomeScore : g.AwayScore;
    const oppScore = isHome ? g.AwayScore : g.HomeScore;
    if (ownScore > oppScore) scheduleWins++;
    else if (ownScore < oppScore) scheduleLosses++;
    else scheduleTies++;
  });
  const hasAnyScores = scheduleWins + scheduleLosses + scheduleTies > 0;
  const recordLabel = scheduleTies > 0
    ? `${scheduleWins}-${scheduleLosses}-${scheduleTies}`
    : `${scheduleWins}-${scheduleLosses}`;

  const ScheduleSidebar = (
    <SidebarCard title={`${ARCHIVE_YEAR} Schedule`} color1={BLUE} color2={GOLD}>
      {hasAnyScores && (
        <div style={{
          padding: "10px 14px", textAlign: "center",
          background: "#f7f8fa", borderBottom: "1px solid #f0f0f0",
        }}>
          <span style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginRight: "8px" }}>
            Record
          </span>
          <span style={{ fontSize: "18px", fontWeight: 900, color: BLUE, letterSpacing: "0.02em" }}>
            {recordLabel}
          </span>
        </div>
      )}
      {schedule.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "#999", fontSize: "13px", fontStyle: "italic" }}>No schedule available.</div>
      ) : (
        schedule.map((g, i) => {
          const isHome = g.Home === canonicalSchool;
          const opponentName = isHome ? g.Away : g.Home;
          const opponentData = schoolsMap[opponentName];
          const isClickable = !!(opponentData && opponentData.Conference);

          const hasScore = g.AwayScore !== undefined && g.AwayScore !== null
            && g.HomeScore !== undefined && g.HomeScore !== null;
          let resultLabel = null;
          let resultColor = "#888";
          if (hasScore) {
            const ownScore = isHome ? g.HomeScore : g.AwayScore;
            const oppScore = isHome ? g.AwayScore : g.HomeScore;
            if (ownScore > oppScore) { resultLabel = `W ${ownScore}-${oppScore}`; resultColor = "#2e7d32"; }
            else if (ownScore < oppScore) { resultLabel = `L ${ownScore}-${oppScore}`; resultColor = "#c0392b"; }
            else { resultLabel = `T ${ownScore}-${oppScore}`; resultColor = "#888"; }
          }

          let dateLabel = "";
          if (g.Date?.toDate) {
            dateLabel = g.Date.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric" });
          } else if (g.Date) {
            const d = new Date(g.Date);
            dateLabel = isNaN(d.getTime()) ? String(g.Date) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
          }

          return (
            <div
              key={g.id || i}
              style={{
                display: "flex", alignItems: "center", gap: "10px", padding: "9px 12px",
                background: "#fff",
                borderBottom: i < schedule.length - 1 ? "1px solid #f0f0f0" : "none",
              }}
            >
              <div style={{ flexShrink: 0, width: "34px", textAlign: "center" }}>
                <div style={{ fontSize: "9px", fontWeight: 900, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {g.Week ? g.Week.replace("Week ", "Wk ") : ""}
                </div>
              </div>
              {opponentData?.Logo1 ? (
                <div style={{
                  width: "26px", height: "26px", flexShrink: 0, display: "flex",
                  alignItems: "center", justifyContent: "center",
                  background: "#f5f5f5", borderRadius: "4px", padding: "2px",
                }}>
                  <img
                    src={sanitizeUrl(opponentData.Logo1)}
                    alt={opponentName}
                    style={{ width: "22px", height: "22px", objectFit: "contain" }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                </div>
              ) : (
                <div style={{
                  width: "26px", height: "26px", flexShrink: 0, borderRadius: "4px",
                  background: "#ddd", display: "flex", alignItems: "center",
                  justifyContent: "center", color: "#888", fontSize: "9px", fontWeight: 900,
                }}>
                  {(opponentName || "?").charAt(0)}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 900, fontSize: "12.5px", lineHeight: 1.2,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  <span style={{ color: "#888", fontWeight: 700 }}>{(isHome || g.Neutral) ? "vs " : "@ "}</span>
                  {isClickable ? (
                    <Link
                      to={`/team/${opponentData.Slug}`}
                      style={{ color: BLUE, textDecoration: "none" }}
                      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                    >
                      {(opponentData?.Short || opponentName).toUpperCase()}
                    </Link>
                  ) : (
                    <span style={{ color: "#444" }}>{(opponentData?.Short || opponentName).toUpperCase()}</span>
                  )}
                  {g.Neutral ? <span style={{ color: "#bbb", fontWeight: 700 }}> (N)</span> : null}
                </div>
                <div style={{ fontSize: "10px", fontWeight: 700, color: resultLabel ? resultColor : "#aaa", lineHeight: 1.3 }}>
                  {resultLabel || dateLabel}
                </div>
              </div>
            </div>
          );
        })
      )}
    </SidebarCard>
  );

  const NewsSidebar = (
    <SidebarCard title="In The News" color1={BLUE} color2={GOLD}>
      {teamNews.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "#999", fontSize: "13px", fontStyle: "italic" }}>No recent news.</div>
      ) : (
        teamNews.map((n, i) => (
          <Link
            key={n.id}
            to={`/news/${n.slug}`}
            style={{
              display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px",
              textDecoration: "none", background: "#fff",
              borderBottom: i < teamNews.length - 1 ? "1px solid #f0f0f0" : "none",
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f7f9fc"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
          >
            <div style={{ flexShrink: 0, width: 36, border: `2px solid ${BLUE}`, borderRadius: "4px", overflow: "hidden" }}>
              <div style={{ background: GOLD, padding: "1px 0", textAlign: "center" }}>
                <span style={{ fontSize: "8px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  {n.publishedAt?.toDate?.().toLocaleDateString(undefined, { month: "short" })}
                </span>
              </div>
              <div style={{ padding: "2px 0", textAlign: "center", background: "#fff" }}>
                <span style={{ fontSize: "15px", fontWeight: 900, color: BLUE, lineHeight: 1, display: "block" }}>
                  {n.publishedAt?.toDate?.().toLocaleDateString(undefined, { day: "numeric" })}
                </span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                backgroundColor: n.type === "article" ? GOLD : BLUE,
                color: "#fff", letterSpacing: "0.06em", fontSize: "7px",
                padding: "2px 5px", display: "inline-block", marginBottom: "3px", borderRadius: "2px",
                fontWeight: 900, textTransform: "uppercase",
              }}>
                {n.type === "article" ? "Article" : "News"}
              </span>
              <div style={{ fontWeight: 900, fontSize: "12px", color: "#222", lineHeight: 1.3, letterSpacing: "0.02em" }}>
                {n.title}
              </div>
            </div>
          </Link>
        ))
      )}
    </SidebarCard>
  );

  return (
    <>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <link rel="canonical" href={`https://we-draft.com/team/${slug}`} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:url" content={`https://we-draft.com/team/${slug}`} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
      </Helmet>

      <div style={{
        maxWidth: "1600px", margin: "0 auto",
        padding: isMobile ? "10px 10px 60px" : "24px 40px 60px",
        fontFamily: "'Arial Black', Arial, sans-serif",
      }}>
        {isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <HeroCard
              school={school} branding={branding} canonicalSchool={canonicalSchool}
              color1={color1} color2={color2} isMobile={isMobile}
            />
            <MainContent
              school={school} canonicalSchool={canonicalSchool}
              color1={color1} color2={color2} isMobile={isMobile}
              activeTab={activeTab} setActiveTab={setActiveTab}
              prospects={prospects} archivePlayers={archivePlayers}
              historicalPlayers={historicalPlayers}
              draftMap={draftMap} nflTeams={nflTeams}
              totalProspects={totalProspects}
            />
            <details style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
              <summary style={{ backgroundColor: BLUE, padding: "10px 14px", cursor: "pointer", listStyle: "none", userSelect: "none" }}>
                <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {school?.Conference || "Conference"} Teams ▾
                </div>
              </summary>
              <div style={{ height: "4px", backgroundColor: GOLD }} />
              <div style={{ background: "#fff" }}>
                {conferenceTeams.map((team, i) => {
                  const isSelf = team.School === canonicalSchool;
                  const rowStyle = {
                    display: "flex", alignItems: "center", gap: "10px", padding: "9px 12px",
                    textDecoration: "none",
                    background: isSelf ? "#fff8e6" : "#fff",
                    borderLeft: isSelf ? `4px solid ${GOLD}` : "4px solid transparent",
                    borderBottom: i < conferenceTeams.length - 1 ? "1px solid #f0f0f0" : "none",
                  };
                  const rowContent = (
                    <>
                      {team.Logo1 ? (
                        <div style={{ width: "24px", height: "24px", flexShrink: 0, background: "#f5f5f5", borderRadius: "3px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <img src={sanitizeUrl(team.Logo1)} alt={team.School} style={{ width: "20px", height: "20px", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        </div>
                      ) : null}
                      <span style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>{team.School}</span>
                      {!isSelf && <span style={{ color: "#ccc", fontSize: "14px", marginLeft: "auto" }}>›</span>}
                    </>
                  );
                  return isSelf ? (
                    <div key={team.Slug || team.School} style={rowStyle}>{rowContent}</div>
                  ) : (
                    <Link key={team.Slug || team.School} to={`/team/${team.Slug}`} style={rowStyle}>
                      {rowContent}
                    </Link>
                  );
                })}
              </div>
            </details>
            {ScheduleSidebar}
            {NewsSidebar}
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "240px minmax(0, 1fr) 240px",
            gap: "20px",
            alignItems: "start",
          }}>
            <div style={{ position: "sticky", top: "20px" }}>
              {ConferenceSidebar}
            </div>
            <div>
              <HeroCard
                school={school} branding={branding} canonicalSchool={canonicalSchool}
                color1={color1} color2={color2} isMobile={isMobile}
              />
              <MainContent
                school={school} canonicalSchool={canonicalSchool}
                color1={color1} color2={color2} isMobile={isMobile}
                activeTab={activeTab} setActiveTab={setActiveTab}
                prospects={prospects} archivePlayers={archivePlayers}
                historicalPlayers={historicalPlayers}
                draftMap={draftMap} nflTeams={nflTeams}
                totalProspects={totalProspects}
              />
            </div>
            <div style={{ position: "sticky", top: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
              {ScheduleSidebar}
              {NewsSidebar}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function HeroCard({ school, branding, canonicalSchool, color1, color2, isMobile }) {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${color1} 0%, ${color1}cc 100%)`,
      borderRadius: "12px", border: `2px solid ${color2}`,
      padding: isMobile ? "18px 16px" : "24px 28px",
      marginBottom: "20px",
      display: "flex", alignItems: "center", gap: isMobile ? "14px" : "22px",
    }}>
      <div style={{ display: "flex", gap: "10px", flexShrink: 0 }}>
        {branding?.logo1 && (
          <div style={{
            background: "#fff", borderRadius: "10px", padding: isMobile ? "6px" : "8px",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
          }}>
            <img
              src={sanitizeUrl(branding.logo1)}
              alt={canonicalSchool}
              style={{ height: isMobile ? "48px" : "72px", objectFit: "contain" }}
              onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }}
            />
          </div>
        )}
        {branding?.logo2 && !isMobile && (
          <div style={{
            background: "#fff", borderRadius: "10px", padding: "8px",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
          }}>
            <img
              src={sanitizeUrl(branding.logo2)}
              alt={canonicalSchool}
              style={{ height: "72px", objectFit: "contain" }}
              onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }}
            />
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: isMobile ? "9px" : "10px", fontWeight: 900, color: color2,
          textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: "4px",
        }}>
          {school?.Conference || "College Football"}
        </div>
        <div style={{
          fontSize: isMobile ? "clamp(18px, 6vw, 26px)" : "clamp(36px, 4vw, 52px)", fontWeight: 900, color: "#fff",
          lineHeight: 1.05, letterSpacing: "0.02em", marginBottom: "6px",
          textTransform: "uppercase", wordBreak: "break-word",
        }}>
          {canonicalSchool}
        </div>
        {school?.Mascot && (
          <div style={{
            fontSize: isMobile ? "14px" : "18px", fontWeight: 700,
            color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: "0.1em",
          }}>
            {school.Mascot}
          </div>
        )}
      </div>
      {branding?.depthChart && !isMobile && (
        <a
          href={sanitizeUrl(branding.depthChart)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flexShrink: 0, background: color2, color: "#fff",
            border: "2px solid #fff", borderRadius: "8px",
            padding: "10px 20px",
            fontWeight: 900, fontSize: "13px",
            textTransform: "uppercase", letterSpacing: "0.06em",
            textDecoration: "none", whiteSpace: "nowrap",
            boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
          }}
        >
          Depth Chart ↗
        </a>
      )}
      {branding?.depthChart && isMobile && (
        <a
          href={sanitizeUrl(branding.depthChart)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flexShrink: 0, background: color2, color: "#fff",
            border: "2px solid #fff", borderRadius: "6px",
            padding: "6px 10px",
            fontWeight: 900, fontSize: "10px",
            textTransform: "uppercase", letterSpacing: "0.04em",
            textDecoration: "none", whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}
        >
          Depth ↗
        </a>
      )}
    </div>
  );
}