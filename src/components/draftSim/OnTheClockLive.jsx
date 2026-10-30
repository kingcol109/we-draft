// src/components/draftSim/OnTheClockLive.jsx
//
// On the Clock's live marker: a pulsing LIVE pill, to the show, while the
// nightly broadcast is on (its start to the end of the final grades' hold);
// nothing otherwise. It reads only the schedule (config/onTheClockShows,
// one small doc) — never a show's script.
import { Link } from "react-router-dom";
import { useNow, useShowLive } from "../../utils/draftSim/onTheClockData";

// Where to watch: the site's own, interactive version (pages/DraftSimLive.jsx).
export const WATCH_PATH = "/draftsim/live";

const CSS = `
  @keyframes wdOtcPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  .wd-otc-dot { animation: wdOtcPulse 1.4s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .wd-otc-dot { animation: none; } }
`;

export default function OnTheClockLive({ isMobile }) {
  const live = useShowLive(useNow(15000));
  if (!live) return null;
  return (
    <Link to={WATCH_PATH} title="On the Clock is live — watch it here" style={{
      display: "inline-flex", alignItems: "center", gap: 7, flexShrink: 0, borderRadius: 999, padding: isMobile ? "5px 11px" : "6px 14px",
      background: "#c8102e", color: "#fff", textDecoration: "none", fontWeight: 900, fontSize: isMobile ? 11 : 12, letterSpacing: "0.1em",
      textTransform: "uppercase", whiteSpace: "nowrap", boxShadow: "0 2px 10px rgba(200,16,46,0.45)",
    }}>
      <style>{CSS}</style>
      <span className="wd-otc-dot" aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />
      Live · On the Clock →
    </Link>
  );
}
