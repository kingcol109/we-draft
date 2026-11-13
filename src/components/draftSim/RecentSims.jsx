// src/components/draftSim/RecentSims.jsx
//
// /draftsim/recent — Recent Drafts: the newest public one-team sims users
// saved (publicDraftSims, utils/draftSim/publicSims.js), every team or one
// (the team picker), either class — just the drafts, no stats over them.
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { NFL_TEAM_ABBRS } from "../../utils/coachHistory";
import { SIM_YEARS } from "../../utils/draftSim/data";
import { loadRecentSims } from "../../utils/draftSim/publicSims";
import { SavedTeamCard, PANEL } from "./SavedSims";
import LoadingSpinner from "../LoadingSpinner";

const GOLD = "#f6a21d";
const BODY = "Arial, sans-serif";
const chip = (on) => ({
  border: `2px solid ${on ? GOLD : "#24324d"}`, background: on ? GOLD : "#0e1626", color: on ? "#fff" : "#c9d4e5",
  borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: 11, letterSpacing: "0.05em",
});

// branding: the sim's setup branding; names: abbr → "New York Jets".
export default function RecentSims({ branding = {}, names, isMobile }) {
  const [team, setTeam] = useState("");
  const [year, setYear] = useState("");
  const [sims, setSims] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setSims(null);
    setError(false);
    loadRecentSims({ team }).then((list) => live && setSims(list))
      .catch((e) => { console.error("Recent draft sims load error:", e); if (live) { setError(true); setSims([]); } });
    return () => { live = false; };
  }, [team]);

  const shown = useMemo(() => (sims || []).filter((s) => !year || s.year === year), [sims, year]);
  const teams = useMemo(() => [...NFL_TEAM_ABBRS].sort((a, b) => names(a).localeCompare(names(b))), [names]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Helmet>
        <title>Recent User Mock Draft Sims | We-Draft</title>
        <meta name="description" content="The latest NFL mock drafts users ran in the We-Draft Draft Simulator — every pick and grade, by team." />
        <link rel="canonical" href="https://we-draft.com/draftsim/recent" />
      </Helmet>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ marginRight: "auto" }}>
          <div style={{ color: GOLD, fontSize: 11, fontWeight: 900, letterSpacing: "0.16em" }}>FROM THE COMMUNITY</div>
          <div style={{ color: "#fff", fontSize: isMobile ? 22 : 28, fontWeight: 900, lineHeight: 1.05 }}>RECENT USER DRAFTS</div>
        </div>
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team"
          style={{ background: "#0e1626", color: "#fff", border: `2px solid ${team ? GOLD : "#24324d"}`, borderRadius: 999, padding: "7px 12px", fontFamily: "inherit", fontWeight: 900, fontSize: 12 }}>
          <option value="">ALL TEAMS</option>
          {teams.map((t) => <option key={t} value={t}>{names(t)}</option>)}
        </select>
        {SIM_YEARS.length > 1 && ["", ...SIM_YEARS].map((y) => (
          <button key={y || "all"} onClick={() => setYear(y)} aria-pressed={year === y} style={chip(year === y)}>{y || "ALL"}</button>
        ))}
      </div>

      {!sims ? <LoadingSpinner label="Loading drafts" size={32} minHeight="30vh" /> : (
        <>
          {shown.length === 0 ? (
            <div style={{ ...PANEL, padding: 28, textAlign: "center", color: "#c9d4e5", fontFamily: BODY, fontSize: 14, lineHeight: 1.6 }}>
              {error ? "Couldn't load drafts — try again." : `No public drafts${team ? ` for the ${names(team)}` : ""} yet. Finish a one-team sim and save it to your profile — it shows up here.`}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", gap: 12, alignItems: "start" }}>
              {shown.map((s) => {
                const date = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
                return (
                  <div key={s.id} style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", color: "#8b9bb4", fontSize: 11, fontFamily: BODY, padding: "0 4px" }}>
                      <span style={{ color: "#fff", fontWeight: 900, fontFamily: "inherit" }}>{s.username || "We-Draft user"}</span>
                      <span>{[s.year, s.rounds ? `${s.rounds} rd${s.rounds === 1 ? "" : "s"}` : "", date].filter(Boolean).join(" · ")}</span>
                    </div>
                    <SavedTeamCard t={{ team: s.team, grade: s.grade, picks: s.picks }} branding={branding} teamName={names} maxPicks={7} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
