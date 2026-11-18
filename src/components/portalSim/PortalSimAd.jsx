// src/components/portalSim/PortalSimAd.jsx
//
// The Transfer Portal Sim's ad on the Draft Sim's end screen (SimResults.jsx),
// under the Sim Profile and this draft's badges (user, 2026-11-18) — the
// Draft Sim's half of the two sims pointing at each other (the Portal Sim's
// Final has the Draft Sim pitch, PortalCommunity.jsx DraftSimPromo). Same
// dark panel as its neighbors; imports nothing heavy.
import { Link } from "react-router-dom";
import { activePortalSeason } from "../../utils/eligibility";

const GOLD = "#f6a21d";
const MARK = "/logos/transfer-portal-white.svg";
const CSS = `.wd-portal-ad { transition: transform .15s, box-shadow .15s, border-color .15s; }
.wd-portal-ad:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(0,0,0,0.35); border-color: ${GOLD} !important; }
.wd-portal-ad:hover .wd-portal-ad-cta { filter: brightness(1.08); }`;

export default function PortalSimAd() {
  const year = activePortalSeason();
  return (
    <Link to="/portalsim" className="wd-portal-ad" aria-label={`Run the ${year} Transfer Portal Simulator`} style={{
      position: "relative", display: "block", overflow: "hidden", textDecoration: "none", color: "#fff", fontFamily: "Arial, sans-serif",
      borderRadius: 16, border: "1px solid #2a3c5e", padding: "16px 16px 14px",
      background: "radial-gradient(circle at 12% 0%, rgba(246,162,29,0.22), transparent 45%), radial-gradient(circle at 100% 100%, rgba(0,85,165,0.6), transparent 60%), linear-gradient(120deg, #0d2f5c 0%, #0a1430 100%)",
    }}>
      <style>{CSS}</style>
      <img src={MARK} alt="" aria-hidden="true" style={{ position: "absolute", right: -26, top: -10, height: 150, opacity: 0.08, transform: "rotate(-8deg)", pointerEvents: "none" }} />
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src={MARK} alt="" aria-hidden="true" style={{ width: 22, height: 22 }} />
          <span style={{ background: "#c8102e", borderRadius: 5, padding: "2px 8px", fontWeight: 900, fontSize: 10, letterSpacing: "0.14em" }}>NEW · PORTAL SIM</span>
        </div>
        <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 19, lineHeight: 1.1, textTransform: "uppercase", margin: "10px 0 6px" }}>
          Now rebuild a <span style={{ color: GOLD }}>college</span> roster
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.82)", marginBottom: 12 }}>
          Take over any FBS program in the {year} transfer portal. Keep your stars from the NFL, make NIL offers, beat every school to your targets and get a grade for your class.
        </div>
        <span className="wd-portal-ad-cta" style={{ display: "block", textAlign: "center", background: GOLD, color: "#fff", borderRadius: 8, padding: "9px 12px", fontWeight: 900, fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Run the Transfer Portal Sim →
        </span>
      </div>
    </Link>
  );
}
