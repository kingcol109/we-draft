// src/components/portalSim/PortalSimButton.jsx
//
// The Transfer Portal's hero button into the Transfer Portal Sim — the
// portal's version of the NFL team page's "ON THE CLOCK · DRAFT" button
// (components/DraftNowButton.jsx; user, 2026-11-18). A white pill with a
// blinking dot over "ENTER THE", then the portal mark and "PORTAL" (user,
// 2026-11-18: "enter the portal", portal the big text) in the
// school's first color (readable on white), its glow the second, and a light
// sweep across it every eight seconds. On /portal (no team: /portalsim) and
// /portal/{team} (/portalsim/{team}, the sim started as that school).
import { Link } from "react-router-dom";
import { readableOn } from "../../utils/teamColors";

const MARK = "/logos/transfer-portal-white.svg";
const CSS = `
  .wd-portal-sim-btn {
    position: relative; isolation: isolate; overflow: visible;
    transition: transform 0.18s cubic-bezier(.2,.9,.3,1.4), box-shadow 0.18s;
  }
  .wd-portal-sim-btn .wd-psb-shine { position: absolute; inset: 0; border-radius: 999px; overflow: hidden; pointer-events: none; }
  .wd-portal-sim-btn .wd-psb-shine::after {
    content: ""; position: absolute; top: 0; bottom: 0; left: -60%; width: 45%;
    background: linear-gradient(100deg, transparent, color-mix(in srgb, var(--pg) 28%, transparent) 50%, transparent 80%);
    transform: skewX(-18deg); animation: wdPsbShine 8s ease-in-out infinite;
  }
  .wd-portal-sim-btn .wd-psb-dot { animation: wdPsbDot 1.1s ease-in-out infinite; }
  .wd-portal-sim-btn .wd-psb-mark { animation: wdPsbSwap 4s ease-in-out infinite; }
  .wd-portal-sim-btn:hover { transform: translateY(-3px) scale(1.05); box-shadow: 0 14px 34px rgba(0,0,0,0.45), 0 0 0 4px color-mix(in srgb, var(--pg) 45%, transparent) !important; }
  .wd-portal-sim-btn:active { transform: translateY(0) scale(0.98); }
  .wd-portal-sim-btn:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }
  @keyframes wdPsbShine { 0%, 85% { left: -60%; } 100% { left: 130%; } }
  @keyframes wdPsbDot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.75); } }
  @keyframes wdPsbSwap { 0%, 70%, 100% { transform: scaleX(1); } 80% { transform: scaleX(-1); } 90% { transform: scaleX(1); } }
  @media (prefers-reduced-motion: reduce) {
    .wd-portal-sim-btn { transition: none !important; }
    .wd-portal-sim-btn .wd-psb-shine::after, .wd-portal-sim-btn .wd-psb-dot, .wd-portal-sim-btn .wd-psb-mark { animation: none !important; }
    .wd-portal-sim-btn:hover { transform: none; }
  }
`;

// team: the school's portal slug (none: the sim's setup screen); school: its
// name (for screen readers); c1 / c2: its colors. wide: a phone hero's — the
// hero's full width, on one line.
export default function PortalSimButton({ team = "", school = "", c1 = "#0055a5", c2 = "#f6a21d", isMobile, wide = false }) {
  const small = isMobile;
  const ink = readableOn(c1, "#ffffff");
  const markSize = wide ? 18 : small ? 18 : 24;
  return (
    <>
      <style>{CSS}</style>
      <Link to={`/portalsim${team ? `/${team}` : ""}`} className="wd-portal-sim-btn"
        aria-label={school ? `Run ${school} in the Transfer Portal Sim` : "Start the Transfer Portal Sim"}
        title={school ? `Run ${school} through the transfer portal` : "Run any school through the transfer portal"}
        style={{
          "--pg": c2, flexShrink: 0, alignSelf: "center", textDecoration: "none", color: ink,
          display: "flex", flexDirection: wide ? "row" : "column", alignItems: "center", justifyContent: "center", gap: wide ? 10 : small ? 2 : 4,
          ...(wide ? { width: "100%", boxSizing: "border-box" } : {}),
          background: "linear-gradient(180deg, #ffffff 0%, #eef1f5 100%)", border: `2px solid ${c2}`, borderRadius: 999,
          padding: wide ? "10px 18px" : small ? "8px 18px 9px" : "11px 28px 12px", boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
        }}>
        <span className="wd-psb-shine" aria-hidden="true" />
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: small ? 9 : 11, fontWeight: 900, letterSpacing: "0.2em", opacity: 0.85, whiteSpace: "nowrap" }}>
          <span className="wd-psb-dot" style={{ width: small ? 6 : 8, height: small ? 6 : 8, borderRadius: "50%", background: "#e11d2e", boxShadow: "0 0 8px rgba(225,29,46,0.7)" }} />
          ENTER THE
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: small ? 6 : 8, fontSize: wide ? 18 : small ? 20 : 26, fontWeight: 900, letterSpacing: "0.1em", lineHeight: 1 }}>
          <span className="wd-psb-mark" aria-hidden="true" style={{
            width: markSize, height: markSize, flexShrink: 0, background: ink,
            WebkitMask: `url(${MARK}) center / contain no-repeat`, mask: `url(${MARK}) center / contain no-repeat`,
          }} />
          PORTAL
        </span>
      </Link>
    </>
  );
}
