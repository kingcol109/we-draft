// src/components/draftSim/SimAdCard.jsx
//
// The Draft Sim ad at the top of the player page's right column (below the
// live scoreboard when he's playing), and above Videos on the Community
// Board. A prospect in a class the sim drafts gets "Where does {Last} go?"
// and that class's sim; a board for a class the sim drafts gets that class;
// anyone else, the default class. `compact` is the one-line strip the board
// shows on mobile. Imports nothing heavy (years.js, not the sim's data).
import { Link } from "react-router-dom";
import { SIM_YEAR, SIM_YEARS } from "../../utils/draftSim/years";

const GOLD = "#f6a21d";
const STYLE = `.wd-sim-ad { transition: transform .15s, box-shadow .15s; } .wd-sim-ad:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(0,0,0,0.28); }`;

export default function SimAdCard({ player, year: classYear, compact }) {
  const want = String(classYear || player?.Eligible || "");
  const year = SIM_YEARS.includes(want) ? want : SIM_YEAR;
  const mine = String(player?.Eligible) === year && player?.Last;
  const to = `/draftsim${year === SIM_YEAR ? "" : `/${year}`}`;
  const base = {
    display: "block", textDecoration: "none", borderRadius: 14, overflow: "hidden", border: `2px solid ${GOLD}`,
    background: "radial-gradient(400px 160px at 20% -30%, #12305c 0%, #070d18 75%), #070d18", boxShadow: "0 8px 22px rgba(0,0,0,0.18)",
    color: "#fff", fontFamily: "Arial, sans-serif",
  };

  if (compact) {
    return (
      <Link to={to} className="wd-sim-ad" aria-label={`Run the ${year} Mock Draft Simulator`} style={{
        ...base, display: "flex", alignItems: "center", gap: 8, borderRadius: 10, padding: "7px 8px 7px 10px",
      }}>
        <style>{STYLE}</style>
        <span style={{ flexShrink: 0, background: "#c8102e", borderRadius: 4, padding: "2px 6px", fontWeight: 900, fontSize: 9, letterSpacing: "0.12em" }}>DRAFT SIM</span>
        <span style={{ flex: 1, minWidth: 0, fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 13, lineHeight: 1.1, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {year} Draft <span style={{ color: GOLD }}>Simulator</span>
        </span>
        <span style={{ flexShrink: 0, background: GOLD, color: "#fff", borderRadius: 6, padding: "5px 9px", fontWeight: 900, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Draft →
        </span>
      </Link>
    );
  }

  return (
    <Link to={to} className="wd-sim-ad" aria-label={`Run the ${year} Mock Draft Simulator`} style={{ ...base, padding: "16px 16px 14px" }}>
      <style>{STYLE}</style>
      <span style={{ display: "inline-block", background: "#c8102e", borderRadius: 5, padding: "2px 8px", fontWeight: 900, fontSize: 10, letterSpacing: "0.14em" }}>DRAFT SIM</span>
      <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 20, lineHeight: 1.1, textTransform: "uppercase", margin: "8px 0 6px" }}>
        {mine ? <>Where does <span style={{ color: GOLD }}>{player.Last}</span> go?</> : <>{year} Mock Draft <span style={{ color: GOLD }}>Simulator</span></>}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.82)", marginBottom: 12 }}>
        {mine
          ? `Run the ${year} NFL Draft live — make every pick, trade up for him, and get a grade from the analyst desk.`
          : `Make every pick in the ${year} NFL Draft — trades, a live analyst desk and a grade for your class.`}
      </div>
      <span style={{ display: "block", textAlign: "center", background: GOLD, color: "#fff", borderRadius: 8, padding: "9px 12px", fontWeight: 900, fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Run the Draft Sim →
      </span>
    </Link>
  );
}
