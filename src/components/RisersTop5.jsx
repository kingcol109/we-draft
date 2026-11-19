// src/components/RisersTop5.jsx
//
// The player page's sidebar card (PlayerProfile.js, where the site-wide
// Trending list used to be): the top 5 of his class's Draft Risers board
// (/risers/{year} — utils/risers.js), each with his label, linking to the
// full list. Nothing when his class has no board yet. The board read is
// shared (loadRiserBoard — cached per class), as are the school logos
// (useSchools).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSchools } from "./DraftArchiveList";
import { RISER_TYPES, loadRiserBoard, risersPath, risersRanked } from "../utils/risers";

const GOLD = "#f6a21d";
const NAVY = "#070d18";
const HEAD = "'Arial Black', Arial, sans-serif";
const BODY = "Arial, sans-serif";
const SHOWN = 5;
const CSS = `
.wd-rt5-row { transition: background .15s, transform .15s; }
a.wd-rt5-row:hover { background: #f5f8fc; }
a.wd-rt5-row:hover .wd-rt5-name { color: #0055a5; }
a.wd-rt5-row:hover .wd-rt5-go { opacity: 1; transform: translateX(0); }
.wd-rt5-go { opacity: 0; transform: translateX(-4px); transition: opacity .15s, transform .15s; }
.wd-rt5-all:hover { filter: brightness(1.08); }
`;

export default function RisersTop5({ player }) {
  const year = String(player?.Eligible || "");
  const [board, setBoard] = useState(undefined);
  useEffect(() => {
    let live = true;
    setBoard(undefined);
    loadRiserBoard(year).then((b) => live && setBoard(b)).catch(() => live && setBoard(null));
    return () => { live = false; };
  }, [year]);
  const ranked = risersRanked(board?.players);
  const top = ranked.slice(0, SHOWN);
  const schools = useSchools(top.map((r) => r.school));
  if (!top.length) return null;
  const mine = ranked.findIndex((r) => r.id === player?.id);

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", background: "#fff", boxShadow: "0 6px 20px rgba(7,13,24,0.12)", border: "1px solid #e2e7ef", fontFamily: BODY }}>
      <style>{CSS}</style>
      {/* Header: the class's risers, in the three labels' colors. */}
      <Link to={risersPath(year)} style={{
        display: "block", textDecoration: "none", color: "#fff", padding: "14px 16px 12px", position: "relative", overflow: "hidden",
        background: `radial-gradient(circle at 0% 120%, ${RISER_TYPES.onFire.c1}cc 0, transparent 55%), radial-gradient(circle at 100% -20%, ${RISER_TYPES.breakout.c1}cc 0, transparent 55%), radial-gradient(circle at 60% 140%, ${RISER_TYPES.up.c1}99 0, transparent 45%), ${NAVY}`,
      }}>
        <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.18em", color: GOLD, textTransform: "uppercase" }}>{year} NFL Draft</div>
        <div style={{ fontFamily: HEAD, fontSize: 24, fontWeight: 900, lineHeight: 1, textTransform: "uppercase", marginTop: 3 }}>Draft Risers</div>
        <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.75)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {mine >= 0 ? `${player.Last} is on the list` : "Prospects on the rise"}
        </div>
      </Link>

      <ol style={{ listStyle: "none", margin: 0, padding: "4px 0" }}>
        {top.map((r, i) => {
          const t = RISER_TYPES[r.type] || RISER_TYPES.up;
          const self = r.id === player?.id;
          const logo = schools[r.school]?.Logo1;
          const body = (
            <>
              <span style={{
                width: 30, height: 30, flexShrink: 0, borderRadius: 8, display: "grid", placeItems: "center", color: "#fff",
                background: `linear-gradient(135deg, ${t.c1}, ${t.c2})`, fontFamily: HEAD, fontSize: 14, fontWeight: 900, boxShadow: `0 3px 8px ${t.c1}44`,
              }}>{i + 1}</span>
              <span style={{ width: 26, height: 26, flexShrink: 0, display: "grid", placeItems: "center" }}>
                {logo && <img src={logo} alt="" loading="lazy" style={{ width: 26, height: 26, objectFit: "contain" }} />}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="wd-rt5-name" style={{ display: "block", fontSize: 14, fontWeight: 900, color: "#1c2330", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "color .15s" }}>
                  {r.first} {r.last}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, minWidth: 0 }}>
                  <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 7px 1px 5px", borderRadius: 999, background: t.tint, color: t.ink, fontSize: 9, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    <span aria-hidden="true">{t.emoji}</span>{t.label}
                  </span>
                  <span title={r.school} style={{ fontSize: 11, fontWeight: 800, color: "#7a8597", whiteSpace: "nowrap" }}>{r.pos}</span>
                </span>
              </span>
              {!self && <span className="wd-rt5-go" aria-hidden="true" style={{ color: "#0055a5", fontSize: 18, fontWeight: 900 }}>›</span>}
            </>
          );
          const row = { display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", textDecoration: "none", borderTop: i ? "1px solid #f0f2f6" : "none" };
          return (
            <li key={r.id}>
              {self ? (
                <div className="wd-rt5-row" style={{ ...row, background: "#fff8e6", boxShadow: `inset 3px 0 0 ${GOLD}` }}>{body}</div>
              ) : (
                <Link to={`/player/${r.slug}`} className="wd-rt5-row" style={row}>{body}</Link>
              )}
            </li>
          );
        })}
      </ol>

      <div style={{ padding: "4px 14px 14px" }}>
        <Link to={risersPath(year)} className="wd-rt5-all" style={{
          display: "block", textAlign: "center", textDecoration: "none", color: "#fff", background: `linear-gradient(135deg, #0055a5, #12305c)`,
          borderRadius: 9, padding: "10px 12px", fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase",
        }}>
          {ranked.length > SHOWN ? `See all ${ranked.length} risers →` : "See the full list →"}
        </Link>
      </div>
    </div>
  );
}
