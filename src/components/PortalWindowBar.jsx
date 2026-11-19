// src/components/PortalWindowBar.jsx
//
// The transfer window on /portal (board and team pages): when it opens and
// closes (utils/draftCalendar.js portal-open / portal-close — the same days
// /events shows), whether it's open now, and the way to the events calendar.
import { Link } from "react-router-dom";
import { DRAFT_EVENTS, parseDay } from "../utils/draftCalendar";

const DAY_MS = 86400000;
const fmt = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export default function PortalWindowBar({ isMobile }) {
  const open = DRAFT_EVENTS.find((e) => e.id === "portal-open");
  const close = DRAFT_EVENTS.find((e) => e.id === "portal-close");
  if (!open || !close) return null;
  const opens = parseDay(open.date), closes = parseDay(close.date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = (d) => Math.round((d - today) / DAY_MS);
  const state = today < opens ? "before" : today <= closes ? "open" : "closed";
  const status = state === "before" ? `Opens in ${days(opens)} day${days(opens) === 1 ? "" : "s"}`
    : state === "open" ? (days(closes) ? `Open now · ${days(closes)} day${days(closes) === 1 ? "" : "s"} left` : "Open now · last day")
      : "Window closed";
  const color = state === "open" ? "#15803d" : state === "before" ? "#b8860b" : "#6b7685";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: isMobile ? 10 : 16, flexWrap: "wrap", marginBottom: isMobile ? 10 : 14,
      background: "#fff", border: "1px solid #e2e7ef", borderLeft: `5px solid ${color}`, borderRadius: 12, padding: isMobile ? "10px 12px" : "12px 18px",
    }}>
      <img src="/logos/transfer-portal.svg" alt="" style={{ width: 30, height: 30, flexShrink: 0 }} />
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8a94a6" }}>
          {opens.getFullYear()} Transfer Window · FBS / FCS
        </div>
        <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 900, color: "#1c2330", marginTop: 2 }}>
          Opens {fmt(opens)} <span style={{ color: "#8a94a6" }}>·</span> Closes {fmt(closes)}
        </div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color, background: `${color}14`, borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap" }}>
        {state === "open" && "● "}{status}
      </span>
      <Link to="/events" style={{ fontSize: 12, fontWeight: 900, color: "#0055a5", textDecoration: "none", whiteSpace: "nowrap" }}>Draft events calendar →</Link>
    </div>
  );
}
