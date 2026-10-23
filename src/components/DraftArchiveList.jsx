// src/components/DraftArchiveList.jsx
//
// Draft pick list with Year/Round/Position filters — the NFL team page's
// Draft Archive (NFLTeamPage.jsx) and a staffer's Draft Record
// (StaffPage.jsx). Rows: year, a round/pick chip, the college logo, then
// name + position/school; a row with a We-Draft slug links to the player.
//
// Entry shape: { key, year, round, pick (null/9999 when unknown),
//   playerName, position, school, slug, teamLogo?, note?, color1?, color2? }
// teamLogo shows under the year (for lists spanning several teams); note is
// appended to the position/school line; color1/color2 override the list's
// colors for that row's pick chip and name (the drafting team's, when a
// list spans several teams).

import { useState, useEffect, useRef, useMemo } from "react";
import ReactDOM from "react-dom";
import { useNavigate } from "react-router-dom";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { cssRect } from "../utils/pageZoom";
import { readableOn } from "../utils/teamColors";

// Team colors are admin-entered hex — tint only when it's actually #rrggbb.
const tint = (hex, alpha) => (/^#[0-9a-f]{6}$/i.test(hex || "") ? `${hex}${alpha}` : "transparent");
const POS_ORDER = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB", "K", "P", "LS"];

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

// College branding (schools/{name} docs: Logo1, LogoDark, Color1, Color2…)
// for a list of school names — batched "in" queries of 10, only for names
// not already fetched. A miss caches as null so it isn't retried.
export function useSchools(schools) {
  const [logos, setLogos] = useState({});
  const logosRef = useRef({});
  useEffect(() => { logosRef.current = logos; }, [logos]);
  const key = [...new Set((schools || []).filter(Boolean))].sort().join("|");
  useEffect(() => {
    const names = key ? key.split("|").filter((s) => !(s in logosRef.current)) : [];
    if (!names.length) return;
    let cancelled = false;
    const chunks = [];
    for (let i = 0; i < names.length; i += 10) chunks.push(names.slice(i, i + 10));
    Promise.all(chunks.map((c) => getDocs(query(collection(db, "schools"), where("School", "in", c)))))
      .then((snaps) => {
        const found = {};
        snaps.forEach((snap) => snap.docs.forEach((d) => {
          const data = d.data();
          if (data.School) found[data.School] = data;
        }));
        names.forEach((s) => { if (!(s in found)) found[s] = null; });
        if (!cancelled) setLogos((prev) => ({ ...prev, ...found }));
      })
      .catch((e) => console.error("School logo fetch error:", e));
    return () => { cancelled = true; };
  }, [key]);
  return logos;
}

// { [school]: Logo1 or "" } — see useSchools.
export function useSchoolLogos(schools) {
  const docs = useSchools(schools);
  return useMemo(() => Object.fromEntries(Object.entries(docs).map(([s, d]) => [s, d?.Logo1 || ""])), [docs]);
}

// Round big, overall pick under it — first-rounders solid team color.
function PickChip({ round, pick, color1, color2, isMobile }) {
  const first = round === 1;
  const size = isMobile ? 46 : 56;
  return (
    <div style={{
      flexShrink: 0, width: size, height: size, borderRadius: 8, boxSizing: "border-box",
      background: first ? color1 : tint(color1, "14"), border: `2px solid ${first ? color2 : tint(color1, "33")}`,
      color: first ? "#fff" : color1, fontVariantNumeric: "tabular-nums",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ fontSize: isMobile ? 17 : 21, fontWeight: 900, lineHeight: 1 }}>R{round || "?"}</div>
      {pick && pick !== 9999 && (
        <div style={{ fontSize: isMobile ? 9 : 10, fontWeight: 900, lineHeight: 1, marginTop: 4, opacity: 0.8 }}>#{pick}</div>
      )}
    </div>
  );
}

export default function DraftArchiveList({ archive, schoolLogos, isMobile, color1, color2, emptyText = "No picks on record" }) {
  const navigate = useNavigate();
  const [selectedYears, setSelectedYears] = useState(new Set());
  const [selectedRounds, setSelectedRounds] = useState(new Set());
  const [selectedPositions, setSelectedPositions] = useState(new Set());
  const [openPanel, setOpenPanel] = useState(null);

  const toggle = (setFn, val) => setFn((prev) => {
    const next = new Set(prev);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  });
  const clearAll = () => { setSelectedYears(new Set()); setSelectedRounds(new Set()); setSelectedPositions(new Set()); setOpenPanel(null); };
  const hasFilters = selectedYears.size > 0 || selectedRounds.size > 0 || selectedPositions.size > 0;

  const allYears = [...new Set(archive.map((e) => e.year))].sort((a, b) => b - a);
  const allRounds = [...new Set(archive.map((e) => e.round).filter(Boolean))].sort((a, b) => a - b);
  const allPositions = [...new Set(archive.map((e) => e.position).filter(Boolean))].sort((a, b) => {
    const ai = POS_ORDER.indexOf(a), bi = POS_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const filtered = archive.filter((e) => {
    if (selectedYears.size > 0 && !selectedYears.has(e.year)) return false;
    if (selectedRounds.size > 0 && !selectedRounds.has(e.round)) return false;
    if (selectedPositions.size > 0 && !selectedPositions.has(e.position)) return false;
    return true;
  });

  if (archive.length === 0) {
    return <div style={{ padding: 32, textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: 14, background: "#fff" }}>{emptyText}</div>;
  }

  const logoSize = isMobile ? 38 : 48;

  return (
    <>
      {openPanel && (
        <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setOpenPanel(null)} onTouchStart={() => setOpenPanel(null)} />
      )}

      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: isMobile ? "10px 12px" : "10px 18px",
        background: "#f7f8fa", borderBottom: "1px solid #e8e8e8",
        position: "relative", zIndex: 100,
      }}>
        <span style={{ fontSize: 11, fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>Filter:</span>
        <ArchiveFilterButton label="Year" options={allYears} panelKey="year" activeSet={selectedYears}
          onToggle={(v) => toggle(setSelectedYears, v)} onClearGroup={() => setSelectedYears(new Set())}
          color1={color1} color2={color2} openPanel={openPanel} setOpenPanel={setOpenPanel} />
        <ArchiveFilterButton label="Round" options={allRounds} panelKey="round" activeSet={selectedRounds}
          onToggle={(v) => toggle(setSelectedRounds, v)} onClearGroup={() => setSelectedRounds(new Set())}
          color1={color1} color2={color2} openPanel={openPanel} setOpenPanel={setOpenPanel} />
        <ArchiveFilterButton label="Position" options={allPositions} panelKey="pos" activeSet={selectedPositions}
          onToggle={(v) => toggle(setSelectedPositions, v)} onClearGroup={() => setSelectedPositions(new Set())}
          color1={color1} color2={color2} openPanel={openPanel} setOpenPanel={setOpenPanel} />
        {hasFilters && (
          <button onClick={clearAll} style={{ border: "2px solid #ccc", borderRadius: 6, padding: "5px 12px", fontWeight: 900, fontSize: 11, color: "#888", background: "#fff", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Clear All
          </button>
        )}
        <span style={{ marginLeft: isMobile ? 0 : "auto", width: isMobile ? "100%" : "auto", fontSize: 11, fontWeight: 700, color: "#aaa" }}>
          {filtered.length} pick{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: "40px 24px", textAlign: "center", background: "#fff" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: color1, textTransform: "uppercase", letterSpacing: "0.06em" }}>No results</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#888", marginTop: 6 }}>Try adjusting your filters.</div>
        </div>
      ) : (
        filtered.map((entry) => {
          const logo = schoolLogos[entry.school];
          const rowColor1 = entry.color1 || color1;
          const rowColor2 = entry.color2 || color2;
          return (
            <div
              key={entry.key}
              onClick={() => entry.slug && navigate(`/player/${entry.slug}`)}
              style={{
                display: "flex", alignItems: "center", gap: isMobile ? 10 : 14,
                padding: isMobile ? "10px 12px" : "12px 16px",
                borderBottom: "1px solid #f0f0f0",
                background: "#fff", cursor: entry.slug ? "pointer" : "default",
              }}
              onMouseEnter={(e) => { if (entry.slug) e.currentTarget.style.background = "#f0f5ff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              <div style={{ flexShrink: 0, width: isMobile ? 34 : 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: isMobile ? 13 : 15, fontWeight: 900, color: "#444" }}>{entry.year}</span>
                {entry.teamLogo && <img src={sanitizeUrl(entry.teamLogo)} alt="" style={{ width: 20, height: 20, objectFit: "contain" }} />}
              </div>

              <PickChip round={entry.round} pick={entry.pick} color1={rowColor1} color2={rowColor2} isMobile={isMobile} />

              <div style={{ flexShrink: 0, width: logoSize, height: logoSize, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {logo && (
                  <div style={{ width: logoSize, height: logoSize, boxSizing: "border-box", background: "#f5f5f5", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", padding: 4 }}>
                    <img src={sanitizeUrl(logo)} alt={entry.school} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }} />
                  </div>
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 900, color: rowColor1, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {entry.playerName || "—"}
                </div>
                <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 700, color: "#555", marginTop: 2 }}>
                  {[entry.position, entry.school, entry.note].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>

              {entry.slug && <div style={{ flexShrink: 0, fontSize: 18, color: readableOn(rowColor2, "#ffffff"), fontWeight: 900 }}>→</div>}
            </div>
          );
        })
      )}
    </>
  );
}

// ── Filter dropdown — renders via portal to escape overflow:hidden
// ancestors, same mechanics as TeamPage.js's own FilterButton. ──
export function ArchiveFilterButton({ label, options, panelKey, activeSet, onToggle, onClearGroup, color1, color2, openPanel, setOpenPanel }) {
  const isOpen = openPanel === panelKey;
  const hasActive = activeSet.size > 0;
  const btnRef = useRef(null);
  const [dropdownStyle, setDropdownStyle] = useState({});

  useEffect(() => {
    if (isOpen && btnRef.current) {
      const rect = cssRect(btnRef.current);
      setDropdownStyle({
        position: "fixed", top: rect.bottom + 6, left: rect.left, zIndex: 99999,
        background: "#fff", border: `2px solid ${color1}`, borderRadius: 8,
        boxShadow: "0 4px 20px rgba(0,0,0,0.18)", minWidth: 160, overflow: "hidden",
      });
    }
  }, [isOpen, color1]);

  const dropdown = isOpen ? ReactDOM.createPortal(
    <div style={dropdownStyle}>
      <div style={{ background: color1, padding: "6px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
        {activeSet.size > 0 && (
          <button onClick={(e) => { e.stopPropagation(); onClearGroup(); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: 10, cursor: "pointer", fontWeight: 700 }}>Clear</button>
        )}
      </div>
      <div style={{ height: 2, background: color2 }} />
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {options.map((val) => {
          const checked = activeSet.has(val);
          return (
            <label key={val} onClick={() => onToggle(val)} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer",
              borderBottom: "1px solid #f0f0f0", background: checked ? `${color1}0d` : "#fff", transition: "background 0.1s",
            }}>
              <div style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0, border: `2px solid ${checked ? color1 : "#ccc"}`, background: checked ? color1 : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {checked && <span style={{ color: "#fff", fontSize: 10, fontWeight: 900, lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#333", textTransform: "uppercase", letterSpacing: "0.04em" }}>
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
        onClick={() => setOpenPanel(isOpen ? null : panelKey)}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          border: `2px solid ${hasActive ? color1 : "#d0d0d0"}`, borderRadius: 6, padding: "5px 10px",
          fontWeight: 900, fontSize: 11, color: hasActive ? color1 : "#666",
          background: hasActive ? `${color1}10` : "#fff", cursor: "pointer",
          textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
        }}
      >
        {label}
        {hasActive && (
          <span style={{ background: color1, color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 900 }}>{activeSet.size}</span>
        )}
        <span style={{ fontSize: 8, color: "#aaa", marginLeft: 2 }}>{isOpen ? "▲" : "▼"}</span>
      </button>
      {dropdown}
    </div>
  );
}
