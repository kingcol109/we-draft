// src/components/TeamPortalPromo.jsx
//
// A college team page's "the portal is open" card (user, 2026-11-20): while
// the transfer window is open (draftCalendar.js portal-open → portal-close),
// it advertises and links to this team's portal page (/portal/{slug}) —
// at the top of the right rail on desktop, right under the header on phones
// (where the rail would sit below the whole prospect list).
//
// Only FBS teams have a portal page; the card shows only once the team's
// portal snapshot (compSnapshots/_portal_{slug}) is found, and uses its
// needs for the "Top needs" line. Preview it out of season with
// ?portalpromo=1.
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { DRAFT_EVENTS, parseDay } from "../utils/draftCalendar";
import { fetchPortalTeamPage } from "../utils/portalData";
import { portalTeamSlug } from "../utils/portalTeams";

const DAY = 86400000;

// { opens, closes (end of the closing day) } or null.
function portalWindow() {
  const open = DRAFT_EVENTS.find((e) => e.id === "portal-open");
  const close = DRAFT_EVENTS.find((e) => e.id === "portal-close");
  if (!open || !close) return null;
  return { opens: parseDay(open.date), closes: new Date(parseDay(close.date).getTime() + DAY - 1) };
}

export function portalWindowOpen(now = new Date()) {
  const w = portalWindow();
  return !!w && now >= w.opens && now <= w.closes;
}

const NEED_WORD = ["", "Depth", "Need", "Big need"];

export default function TeamPortalPromo({ school, color1 = "#0055a5", color2 = "#f6a21d", isMobile = false }) {
  const { search } = useLocation();
  const preview = new URLSearchParams(search).get("portalpromo") === "1";
  const open = portalWindowOpen() || preview;
  const name = school?.School || "";
  const slug = portalTeamSlug(name);
  const [page, setPage] = useState(undefined);

  useEffect(() => {
    let live = true;
    setPage(undefined);
    if (!open || !slug) return undefined;
    fetchPortalTeamPage(slug).then((d) => { if (live) setPage(d || null); }).catch(() => { if (live) setPage(null); });
    return () => { live = false; };
  }, [open, slug]);

  if (!open || !page) return null;

  const w = portalWindow();
  const daysLeft = w ? Math.max(0, Math.ceil((w.closes.getTime() - Date.now()) / DAY)) : null;
  const closesLine = daysLeft == null ? "" : daysLeft <= 1 ? "Closes today" : `${daysLeft} days left`;
  const needs = Object.entries(page.needs || {})
    .filter(([, v]) => v >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const logo = school?.LogoDark || school?.Logo1 || "";
  const to = `/portal/${slug}`;

  return (
    <Link to={to} aria-label={`${name} Transfer Portal tracker`} className="wd-tpp" style={{
      position: "relative", overflow: "hidden", display: "block", textDecoration: "none", color: "#fff",
      borderRadius: 14, padding: isMobile ? "14px 14px 14px" : "16px 16px 16px",
      background: `linear-gradient(rgba(0,0,0,0.34), rgba(0,0,0,0.34)), linear-gradient(125deg, ${color1} 0%, ${color1} 45%, ${color2} 100%)`,
      boxShadow: "0 10px 26px rgba(0,0,0,0.2)", border: `2px solid ${color2}`,
    }}>
      <style>{`
        .wd-tpp { transition: transform .15s ease, box-shadow .15s ease; }
        .wd-tpp:hover { transform: translateY(-2px); box-shadow: 0 14px 30px rgba(0,0,0,0.26) !important; }
        .wd-tpp-dot { width: 8px; height: 8px; border-radius: 50%; background: #3ee07a; box-shadow: 0 0 0 0 rgba(62,224,122,.7); animation: wdTppPulse 1.8s ease-out infinite; }
        @keyframes wdTppPulse { 0% { box-shadow: 0 0 0 0 rgba(62,224,122,.7); } 70% { box-shadow: 0 0 0 9px rgba(62,224,122,0); } 100% { box-shadow: 0 0 0 0 rgba(62,224,122,0); } }
        @media (prefers-reduced-motion: reduce) { .wd-tpp, .wd-tpp-dot { animation: none; transition: none; } }
      `}</style>
      {/* faint portal arrows */}
      <svg aria-hidden="true" width="150" height="150" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
        style={{ position: "absolute", right: -28, bottom: -34, opacity: 0.1, pointerEvents: "none" }}>
        <path d="M4 8h14l-4-4M20 16H6l4 4" />
      </svg>

      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>
        <span className="wd-tpp-dot" />
        {/* The desktop rail is narrow (240px): shorter, days left below. */}
        {isMobile ? "Transfer Portal Is Open" : "Portal Is Open"}
        {closesLine && isMobile && <span style={{ marginLeft: "auto", letterSpacing: "0.06em", opacity: 0.8, whiteSpace: "nowrap" }}>{closesLine}</span>}
      </div>

      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        {logo && <img src={logo} alt="" style={{ width: isMobile ? 44 : 48, height: isMobile ? 44 : 48, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.35))" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? 17 : 18, fontWeight: 900, lineHeight: 1.1, textTransform: "uppercase", letterSpacing: "0.02em" }}>{name} Portal Tracker</div>
          {!isMobile && closesLine && <div style={{ marginTop: 3, fontSize: 10.5, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.8 }}>{closesLine}</div>}
        </div>
      </div>
      <div style={{ position: "relative", marginTop: 8, fontSize: 12, fontWeight: 700, lineHeight: 1.4, color: "rgba(255,255,255,0.88)", fontFamily: "Arial, sans-serif" }}>
        Every move in and out, the projected roster and our targets.
      </div>

      {needs.length > 0 && (
        <div style={{ position: "relative", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.8, marginRight: 2 }}>Top needs</span>
          {needs.map(([pos, v]) => (
            <span key={pos} title={NEED_WORD[v] || ""} style={{ fontSize: 11, fontWeight: 900, padding: "3px 8px", borderRadius: 999, background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.28)" }}>{pos}</span>
          ))}
        </div>
      )}

      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12, padding: "10px 12px", borderRadius: 10,
        background: "#fff", color: "#0b2545", fontSize: 12.5, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {isMobile ? `Open the ${name} Portal` : "Open the Portal"}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </div>
    </Link>
  );
}
