// src/components/DraftNowButton.jsx
//
// The hero's "ON THE CLOCK · DRAFT" button — starts the Draft Sim as a team
// (/draftsim/{team}). On the NFL team page (NFLTeamPage.jsx) and a staff
// page (StaffPage.jsx, the person's current team). A light sweep across it
// every eight seconds and a blinking "on the clock" dot; its text takes the
// team's first color (readable on white) and its glow the second.
import { Link } from "react-router-dom";
import { readableOn } from "../utils/teamColors";

const CSS = `
  .wd-nfl-draft-btn {
    position: relative; isolation: isolate; overflow: visible;
    transition: transform 0.18s cubic-bezier(.2,.9,.3,1.4), box-shadow 0.18s;
  }
  .wd-nfl-draft-btn .wd-draft-shine {
    position: absolute; inset: 0; border-radius: 999px; overflow: hidden; pointer-events: none;
  }
  .wd-nfl-draft-btn .wd-draft-shine::after {
    content: ""; position: absolute; top: 0; bottom: 0; left: -60%; width: 45%;
    background: linear-gradient(100deg, transparent, rgba(255,255,255,0.0) 20%, color-mix(in srgb, var(--dg) 28%, transparent) 50%, transparent 80%);
    transform: skewX(-18deg); animation: wdDraftShine 8s ease-in-out infinite;
  }
  .wd-nfl-draft-btn .wd-draft-dot { animation: wdDraftDot 1.1s ease-in-out infinite; }
  .wd-nfl-draft-btn:hover { transform: translateY(-3px) scale(1.05); box-shadow: 0 14px 34px rgba(0,0,0,0.45), 0 0 0 4px color-mix(in srgb, var(--dg) 45%, transparent) !important; }
  .wd-nfl-draft-btn:active { transform: translateY(0) scale(0.98); }
  .wd-nfl-draft-btn:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }
  /* The sweep itself takes ~1.2s at the end of each 8s cycle. */
  @keyframes wdDraftShine {
    0%, 85% { left: -60%; }
    100%    { left: 130%; }
  }
  @keyframes wdDraftDot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.35; transform: scale(0.75); }
  }
  @media (prefers-reduced-motion: reduce) {
    .wd-nfl-draft-btn { transition: none !important; }
    .wd-nfl-draft-btn .wd-draft-shine::after, .wd-nfl-draft-btn .wd-draft-dot { animation: none !important; }
    .wd-nfl-draft-btn:hover { transform: none; }
  }
`;

// team: the abbreviation; teamName: "Cleveland Browns" (for screen readers).
// No team: the sim's own start (/draftsim — the full weekly mock's banner).
// year: another class than the sim's default (/draftsim/2028/{team}).
// compact: the phone size everywhere (the weekly mock's pages, where it
// sits in a banner rather than a hero). wide: a phone hero's — the hero's
// full width under the name, on one line.
export default function DraftNowButton({ team, teamName, c1, c2, isMobile, compact = false, wide = false, year = "" }) {
  const small = isMobile || compact;
  return (
    <>
      <style>{CSS}</style>
      <Link to={`/draftsim${year ? `/${year}` : ""}${team ? `/${team.toLowerCase()}` : ""}`} className="wd-nfl-draft-btn"
        aria-label={team ? `Draft as the ${teamName} in the Draft Sim` : "Start the Draft Sim"}
        style={{
          "--dc": readableOn(c1, "#ffffff"), "--dg": c2,
          flexShrink: 0, alignSelf: "center", textDecoration: "none",
          display: "flex", flexDirection: wide ? "row" : "column", alignItems: "center", justifyContent: "center", gap: wide ? 10 : small ? 2 : 4,
          ...(wide ? { width: "100%", boxSizing: "border-box" } : {}),
          background: "linear-gradient(180deg, #ffffff 0%, #eef1f5 100%)",
          color: "var(--dc)", border: `2px solid ${c2}`, borderRadius: 999,
          padding: wide ? "10px 18px" : small ? "8px 18px 9px" : "14px 44px 16px",
          boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
        }}>
        <span className="wd-draft-shine" aria-hidden="true" />
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: small ? 9 : 11, fontWeight: 900, letterSpacing: "0.2em", opacity: 0.85 }}>
          <span className="wd-draft-dot" style={{ width: small ? 6 : 8, height: small ? 6 : 8, borderRadius: "50%", background: "#e11d2e", boxShadow: "0 0 8px rgba(225,29,46,0.7)" }} />
          ON THE CLOCK
        </span>
        <span style={{ fontSize: wide ? 18 : small ? 20 : 34, fontWeight: 900, letterSpacing: "0.1em", lineHeight: 1 }}>
          DRAFT
        </span>
      </Link>
    </>
  );
}
