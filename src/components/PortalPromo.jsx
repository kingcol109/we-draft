// src/components/PortalPromo.jsx
//
// The Transfer Portal's promos, for Portal News (pages/PortalNews.jsx) —
// woven into the page rather than boxed off as ads:
//   PortalSimRailCard    side rail: the Transfer Portal Sim (/portalsim)
//   PortalBoardRailCard  side rail: the live portal board (/portal), by position
//   PortalSimBanner      in the feed, after the players who entered: "where
//                        should he go?" — an offer board with those players,
//                        each a way into the sim
//   PortalBoardBanner    in the feed, after the commitments: the live portal,
//                        by position
import { Link } from "react-router-dom";

const GOLD = "#f6a21d";
const BLUE = "#0055a5";
const HEAD = "'Arial Black', Arial, sans-serif";
const BODY = "Arial, sans-serif";
const PORTAL_MARK = "/logos/transfer-portal-white.svg";
const POSITIONS = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB"];
const STYLE = `.wd-pp { transition: transform .15s, box-shadow .15s; } .wd-pp:hover { transform: translateY(-2px); box-shadow: 0 16px 34px rgba(0,0,0,0.3); }
.wd-pp:hover .wd-pp-cta { filter: brightness(1.08); }
.wd-pp-row { transition: background .15s; } .wd-pp-row:hover { background: rgba(255,255,255,0.12) !important; }
.wd-pp-pos { transition: background .15s, color .15s; } .wd-pp-pos:hover { background: ${GOLD} !important; color: #0b1a33 !important; }`;
const darkBg = "radial-gradient(420px 260px at 92% -10%, #1d4580 0%, transparent 70%), radial-gradient(360px 240px at -5% 120%, #5a3a00 0%, transparent 70%), linear-gradient(180deg, #0b1a33 0%, #070d18 100%)";
const tag = (bg, color = "#fff") => ({ display: "inline-block", background: bg, color, borderRadius: 5, padding: "3px 8px", fontWeight: 900, fontSize: 10, letterSpacing: "0.14em" });
const cta = { display: "inline-block", textAlign: "center", background: GOLD, color: "#0b1a33", borderRadius: 10, padding: "11px 16px", fontWeight: 900, fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap", textDecoration: "none" };

// The portal's rings, as decoration.
function Rings({ size = 180, style }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 200 200" style={{ position: "absolute", pointerEvents: "none", ...style }}>
      {[[92, GOLD, "60 14 22 10", 0.55], [74, "#4f8fe0", "44 10 16 8", 0.6], [56, GOLD, "30 8 12 6", 0.7], [38, "#4f8fe0", "20 6 8 5", 0.75]].map(([r, c, d, o]) => (
        <circle key={r} cx="100" cy="100" r={r} fill="none" stroke={c} strokeWidth={r > 60 ? 5 : 4} strokeDasharray={d} strokeLinecap="round" opacity={o} />
      ))}
      <circle cx="100" cy="100" r="22" fill={GOLD} opacity="0.35" />
    </svg>
  );
}

export function PortalSimRailCard() {
  return (
    <Link to="/portalsim" className="wd-pp" aria-label="Play the Transfer Portal Sim" style={{ display: "block", position: "relative", overflow: "hidden", textDecoration: "none", color: "#fff", borderRadius: 14, background: darkBg, border: `1px solid ${GOLD}66`, boxShadow: "0 8px 22px rgba(7,13,24,0.22)", fontFamily: BODY }}>
      <style>{STYLE}</style>
      <Rings size={170} style={{ right: -50, top: -40, opacity: 0.6 }} />
      <div style={{ position: "relative", padding: 14 }}>
        <span style={tag("#c8102e")}>PORTAL SIM</span>
        {/* An offer on the table. */}
        <div style={{ marginTop: 12, borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", padding: "10px 12px" }}>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color: GOLD }}>NIL OFFER SENT</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontFamily: HEAD, fontSize: 14, fontWeight: 900 }}>5★ EDGE</span>
            <span style={{ fontSize: 11, fontWeight: 900, color: "#4ade80" }}>● Interested</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.12)", marginTop: 8, overflow: "hidden" }}>
            <div style={{ width: "72%", height: "100%", background: `linear-gradient(90deg, ${GOLD}, #ffd36b)` }} />
          </div>
        </div>
        <div style={{ fontFamily: HEAD, fontSize: 20, fontWeight: 900, lineHeight: 1.05, textTransform: "uppercase", marginTop: 12 }}>
          Transfer Portal <span style={{ color: GOLD }}>Sim</span>
        </div>
        <ul style={{ listStyle: "none", margin: "10px 0 14px", padding: 0, display: "grid", gap: 5, fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>
          {["Take over any FBS program", "Make NIL offers", "Beat rivals to targets", "Get your class graded"].map((x) => (
            <li key={x} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: "50%", background: `${GOLD}33`, color: GOLD, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>✓</span>{x}
            </li>
          ))}
        </ul>
        <span className="wd-pp-cta" style={{ ...cta, display: "block", padding: "10px", fontSize: 12 }}>Play the Sim →</span>
      </div>
    </Link>
  );
}

export function PortalBoardRailCard() {
  return (
    <div className="wd-pp" style={{ position: "relative", overflow: "hidden", color: "#fff", borderRadius: 14, background: darkBg, border: "1px solid #4f8fe066", boxShadow: "0 8px 22px rgba(7,13,24,0.22)", fontFamily: BODY }}>
      <style>{STYLE}</style>
      <div style={{ position: "relative", padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src={PORTAL_MARK} alt="" style={{ width: 22, height: 22 }} />
          <span style={tag(BLUE)}>LIVE PORTAL</span>
        </div>
        <div style={{ fontFamily: HEAD, fontSize: 20, fontWeight: 900, lineHeight: 1.05, textTransform: "uppercase", marginTop: 10 }}>
          Every <span style={{ color: GOLD }}>move</span>, as it happens
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.75)", marginTop: 6, lineHeight: 1.45 }}>Entries, commitments and transfer stars for every FBS team.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 12 }}>
          {POSITIONS.map((p) => (
            <Link key={p} to={`/portal/${p.toLowerCase()}`} className="wd-pp-pos" style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", color: "#fff", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "4px 7px", textDecoration: "none" }}>{p}</Link>
          ))}
        </div>
        <Link to="/portal" className="wd-pp-cta" style={{ ...cta, display: "block", padding: "10px", fontSize: 12, marginTop: 14, background: "#fff" }}>Open the Portal →</Link>
      </div>
    </div>
  );
}

// After the players who entered: where should they go? Each a way into the sim.
export function PortalSimBanner({ players = [], schools = {}, isMobile }) {
  const lead = players[0];
  return (
    <aside aria-label="Transfer Portal Sim" style={{ position: "relative", overflow: "hidden", borderRadius: 18, background: darkBg, color: "#fff", fontFamily: BODY, border: `1px solid ${GOLD}55`, boxShadow: "0 14px 34px rgba(7,13,24,0.28)" }}>
      <style>{STYLE}</style>
      <Rings size={isMobile ? 220 : 340} style={{ left: isMobile ? -90 : -120, bottom: isMobile ? -110 : -150, opacity: 0.45 }} />
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.05fr 1fr", gap: isMobile ? 16 : 26, padding: isMobile ? "20px 16px" : "26px 30px", alignItems: "center" }}>
        <div>
          <span style={tag("#c8102e")}>TRANSFER PORTAL SIM</span>
          <h2 style={{ margin: "12px 0 0", fontFamily: HEAD, fontSize: isMobile ? 26 : 34, fontWeight: 900, lineHeight: 1.02, textTransform: "uppercase", letterSpacing: "-0.01em" }}>
            {lead ? <>Where should <span style={{ color: GOLD }}>{lead.last}</span> go?</> : <>Build your <span style={{ color: GOLD }}>portal class</span></>}
            <span style={{ display: "block", fontSize: isMobile ? 18 : 22, color: "rgba(255,255,255,0.85)", marginTop: 6 }}>You make the call.</span>
          </h2>
          <p style={{ margin: "12px 0 18px", fontSize: isMobile ? 14 : 15, lineHeight: 1.6, fontWeight: 600, color: "rgba(255,255,255,0.8)", maxWidth: 440 }}>
            Take over any FBS program, put NIL offers on the table and beat every school to the players you want. Then get your portal class graded.
          </p>
          <Link to="/portalsim" className="wd-pp-cta" style={cta}>Play the Portal Sim →</Link>
        </div>
        {players.length > 0 && (
          <div style={{ borderRadius: 14, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color: "rgba(255,255,255,0.6)", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              <span>YOUR TARGET BOARD</span><span>NIL OFFER</span>
            </div>
            {players.slice(0, 4).map((e) => {
              const logo = schools[e.from]?.LogoDark || schools[e.from]?.Logo1;
              return (
                <Link key={e.id} to="/portalsim" className="wd-pp-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", color: "#fff", textDecoration: "none", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "transparent" }}>
                  <span style={{ width: 30, height: 30, flexShrink: 0, display: "grid", placeItems: "center" }}>{logo && <img src={logo} alt="" style={{ width: 28, height: 28, objectFit: "contain" }} />}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontFamily: HEAD, fontSize: 14, fontWeight: 900, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.first} {e.last}</span>
                    <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>{e.pos} · {e.from}</span>
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", color: "#0b1a33", background: GOLD, borderRadius: 7, padding: "6px 10px" }}>OFFER</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

// After the commitments: the live portal, by position.
export function PortalBoardBanner({ isMobile, onMoves = false }) {
  // The same banner on every page (no position version): to the main portal.
  // The words left, one "Every …" a line; the portal's mark right, in its rings.
  // (A phone: the words take the full width — one "Every …" a line — and the mark sits small in the corner.)
  const mark = isMobile ? 58 : 150;
  return (
    <aside aria-label="The live Transfer Portal" style={{ position: "relative", overflow: "hidden", borderRadius: 18, background: `linear-gradient(120deg, ${BLUE} 0%, #0a3a73 55%, #071d3d 100%)`, color: "#fff", fontFamily: BODY, boxShadow: "0 14px 34px rgba(0,40,90,0.25)" }}>
      <style>{STYLE}</style>
      <div style={{ position: "relative", padding: isMobile ? "20px 16px" : "26px 30px", display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : `minmax(0, 1fr) ${mark + 50}px`, gap: 20, alignItems: "center" }}>
        <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontFamily: HEAD, fontSize: isMobile ? 22 : 32, fontWeight: 900, lineHeight: 1.04, textTransform: "uppercase", whiteSpace: "nowrap" }}>
            <span style={{ display: "block" }}>Every entry.</span>
            <span style={{ display: "block" }}>Every commitment.</span>
            <span style={{ display: "block", color: GOLD }}>Every team.</span>
          </h2>
          <p style={{ margin: 0, fontSize: isMobile ? 14 : 15, lineHeight: 1.6, fontWeight: 600, color: "rgba(255,255,255,0.85)", maxWidth: 560 }}>
            The full portal board with transfer stars, eligibility and where every player landed — plus each team's movement, roster and targets.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {POSITIONS.map((p) => (
              <Link key={p} to={`/portal/${p.toLowerCase()}`} className="wd-pp-pos" style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", color: "#fff", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "7px 11px", textDecoration: "none" }}>{p}</Link>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link to="/portal" className="wd-pp-cta" style={cta}>Open the Portal →</Link>
            {!onMoves && <Link to="/portal/news/updates" style={{ ...cta, background: "transparent", color: "#fff", border: "2px solid rgba(255,255,255,0.5)", padding: "9px 14px" }}>Latest Moves</Link>}
          </div>
        </div>
        {/* The portal's mark, in its rings — to the main portal. */}
        <Link to="/portal" aria-label="Open the Transfer Portal" style={{ ...(isMobile ? { position: "absolute", top: 16, right: 14 } : { position: "relative", justifySelf: "center", alignSelf: "center" }), width: mark, height: mark, display: "grid", placeItems: "center" }}>
          <Rings size={mark * 1.9} style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)", opacity: 0.55 }} />
          <img src={PORTAL_MARK} alt="" style={{ position: "relative", width: mark * 0.62, height: mark * 0.62, filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.35))" }} />
        </Link>
      </div>
    </aside>
  );
}
