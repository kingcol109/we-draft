// src/components/NFLTeamRail.jsx
//
// Left-margin list of all 32 NFL teams, by division, on the NFL team page
// (NFLTeamPage.jsx). Each link keeps the tab being viewed; the current team
// is highlighted. The page places it in the gutter beside its centered
// column, and only when the window has room — the column never moves.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { NFL_TEAMS } from "../utils/coachHistory";
import { fetchNflBranding } from "../utils/draftProfileData";

// Also the navbar's NFL dropdown (Navbar.js).
export const NFL_DIVISIONS = [
  ["AFC East", ["BUF", "MIA", "NE", "NYJ"]], ["AFC North", ["BAL", "CIN", "CLE", "PIT"]],
  ["AFC South", ["HOU", "IND", "JAX", "TEN"]], ["AFC West", ["DEN", "KC", "LV", "LAC"]],
  ["NFC East", ["DAL", "NYG", "PHI", "WAS"]], ["NFC North", ["CHI", "DET", "GB", "MIN"]],
  ["NFC South", ["ATL", "CAR", "NO", "TB"]], ["NFC West", ["ARI", "LAR", "SF", "SEA"]],
];

const tint = (hex, alpha) => (/^#[0-9a-f]{6}$/i.test(hex || "") ? `${hex}${alpha}` : "transparent");

export default function NFLTeamRail({ currentTeam, tabSuffix = "", color1 }) {
  const [teams, setTeams] = useState({});
  useEffect(() => {
    let cancelled = false;
    // Logos/names from the shared _nflBranding snapshot (one read, cached).
    fetchNflBranding().then((t) => { if (!cancelled) setTeams(t); }).catch((e) => console.error("Team rail load error:", e));
    return () => { cancelled = true; };
  }, []);

  return (
    <aside style={{
      position: "sticky", top: 16, maxHeight: "calc(100vh / var(--pz, 1) - 32px)", overflowY: "auto",
      background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2", padding: "6px 0",
    }}>
      {NFL_DIVISIONS.map(([division, abbrs]) => (
        <div key={division}>
          <div style={{ padding: "8px 12px 4px", fontSize: 9, fontWeight: 900, color: "#9aa5b4", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            {division}
          </div>
          {abbrs.map((abbr) => {
            const active = abbr === currentTeam;
            const t = teams[abbr];
            const name = t?.Team || (NFL_TEAMS[abbr] || abbr).split(" ").pop();
            return (
              <Link
                key={abbr} to={`/nfl/${abbr.toLowerCase()}${tabSuffix}`} aria-current={active ? "page" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "5px 12px", textDecoration: "none",
                  background: active ? tint(color1, "14") : "transparent", borderLeft: `3px solid ${active ? color1 : "transparent"}`,
                }}
              >
                {t?.Logo1
                  ? <img src={t.Logo1} alt="" style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} />
                  : <span style={{ width: 22, flexShrink: 0, fontSize: 9, fontWeight: 900, color: "#9aa5b4" }}>{abbr}</span>}
                <span style={{ fontSize: 12, fontWeight: 900, color: active ? color1 : "#1a1f2b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {name}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
