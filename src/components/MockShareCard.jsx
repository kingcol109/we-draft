// src/components/MockShareCard.jsx
//
// The mock draft share image — drawn off screen and captured by the
// caller (html-to-image): the mock editor's / viewer's Share
// (ShareMockButton.jsx) and the Draft Sim's Mock Draft results
// (draftSim/SimResults.jsx). Near square for X / Instagram: a header with
// the title, two columns of picks down the page (a full 32-pick round fits)
// each with its team's color stripe and abbreviation, the player big and
// his position and school under him, and the site along the bottom.
//
// Flat colors and text only — an externally hosted logo can taint the
// canvas and blank the whole export, so no images.
import { forwardRef } from "react";
import { textOn } from "../utils/teamColors";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const NAVY = "#071a33";
const CARD_W = 1000;
const BODY = "Arial, Helvetica, sans-serif";
const HEAVY = "'Arial Black', Arial, sans-serif";

// rows: [{ pickNumber, team (abbr), color1, color2, player: { First, Last,
// Position, School } | null, via }]; eyebrow ("2027 NFL MOCK DRAFT · ROUND
// 1"), title, byline, footer (the site line).
const MockShareCard = forwardRef(function MockShareCard({ eyebrow, title, byline, rows, footer, moreNote }, ref) {
  const perCol = Math.max(1, Math.ceil(rows.length / 2));
  return (
    <div ref={ref} style={{ width: CARD_W, background: NAVY, fontFamily: HEAVY, color: "#fff", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ position: "relative", padding: "34px 44px 28px", background: `linear-gradient(120deg, #0a2a52 0%, ${BLUE} 70%, #1c6fc4 100%)` }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 10, background: GOLD }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 22, color: GOLD, letterSpacing: "0.06em" }}>WE-DRAFT.COM</span>
          <span style={{ flex: 1, height: 2, background: "rgba(255,255,255,0.25)" }} />
          <span style={{ fontSize: 15, letterSpacing: "0.18em", color: "rgba(255,255,255,0.85)" }}>{eyebrow}</span>
        </div>
        <div style={{ fontSize: title && title.length > 28 ? 40 : 52, lineHeight: 1.05, textTransform: "uppercase", marginTop: 14, letterSpacing: "0.01em" }}>
          {title || "My Mock Draft"}
        </div>
        {byline && <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 18, color: "rgba(255,255,255,0.8)", marginTop: 8 }}>By {byline}</div>}
      </div>
      <div style={{ height: 5, background: GOLD }} />

      {/* Picks, down the columns */}
      <div style={{ padding: "22px 30px 24px" }}>
        {rows.length === 0 ? (
          <div style={{ textAlign: "center", fontFamily: BODY, fontStyle: "italic", fontSize: 20, color: "rgba(255,255,255,0.5)", padding: "40px 0" }}>No picks made yet.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: `repeat(${perCol}, auto)`, gridAutoFlow: "column", columnGap: 18, rowGap: 7 }}>
            {rows.map((r) => {
              const c1 = r.color1 || BLUE;
              const c2 = r.color2 || GOLD;
              return (
                <div key={r.pickNumber} style={{ display: "flex", alignItems: "stretch", minWidth: 0, height: 52, background: "rgba(255,255,255,0.055)", borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ width: 46, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: GOLD, background: "rgba(0,0,0,0.25)" }}>{r.pickNumber}</div>
                  <div style={{ width: 62, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: c1, color: textOn(c1, c2), fontSize: 15, letterSpacing: "0.04em", borderRight: `4px solid ${c2}` }}>{r.team}</div>
                  <div style={{ flex: 1, minWidth: 0, padding: "0 12px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    {r.player ? (
                      <>
                        <div style={{ fontSize: 18, lineHeight: 1.1, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.player.First} {r.player.Last}</div>
                        <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {r.player.Position}{r.player.School ? ` · ${r.player.School}` : ""}{r.via ? ` · via ${r.via}` : ""}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontFamily: BODY, fontWeight: 700, fontStyle: "italic", fontSize: 15, color: "rgba(255,255,255,0.4)" }}>TBD</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {moreNote && <div style={{ textAlign: "center", fontFamily: BODY, fontWeight: 700, fontSize: 15, color: "rgba(255,255,255,0.55)", marginTop: 14 }}>{moreNote}</div>}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 44px", background: GOLD, color: NAVY }}>
        <span style={{ fontSize: 20, letterSpacing: "0.04em" }}>WE-DRAFT.COM</span>
        <span style={{ fontSize: 16, letterSpacing: "0.06em", textTransform: "uppercase" }}>{footer}</span>
      </div>
    </div>
  );
});

export default MockShareCard;

// A pick row from a team map ({ [abbr]: { Color1, Color2 } }).
export const shareRow = (teams, { pickNumber, team, player, via }) => ({
  pickNumber, team, player, via: via || null, color1: teams?.[team]?.Color1, color2: teams?.[team]?.Color2,
});
