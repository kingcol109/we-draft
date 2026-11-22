// src/components/print/TradingCard.jsx
//
// The printed trading card (Admin → Print → Trading Cards,
// components/AdminCards.jsx): 2.5 × 3.5 in, with a 0.125 in bleed all round
// (2.75 × 3.75 in — 264 × 360 px at 96 px/in), front and back.
//
// One design for now, "Draft Night" — the generic We-Draft.com draft card
// from the NFL draft targets pages:
//   Front  the draft-night graphic (utils/instagram/draftCard.js, drawn by
//          components/DraftCardGraphic.jsx) — 4:5, so it sits inside the
//          safe area in a dark card border with a thin gold rule, and a
//          footer strip under it ("2027 NFL Draft Prospect" · We-Draft.com).
//          Nothing that matters comes near a cut.
//   Back   the targets page's flip side (ScoutCard CardBack, the blue/navy
//          "night" theme): headshot, bio, season stats, community grade and
//          traits — no team data (shared graphics stay team-neutral).
// The bleed is filled with the card's own dark background, so a cut that
// drifts shows more of the same. Guides (screen only): bleed tint, trim
// line, safe area.
import { CardBack, cardBackGround } from "../ScoutCard";
import { useDisplayFont } from "./EvaluationPage";

export const PX = 96;
export const CARD_BLEED = 0.125 * PX; // 12
export const CARD_TRIM_W = 2.5 * PX; // 240
export const CARD_TRIM_H = 3.5 * PX; // 336
export const CARD_W = CARD_TRIM_W + CARD_BLEED * 2; // 264
export const CARD_H = CARD_TRIM_H + CARD_BLEED * 2; // 360
export const CARD_SAFE = 0.125 * PX; // inside the trim
export const CARD_PAGE = "2.75in 3.75in";

const DISPLAY = "'WD Bebas', 'Bebas Neue', Impact, 'Arial Narrow', sans-serif";
const GOLD = "#f6a21d";
const NIGHT = { c1: "#0055a5", c2: "#0a2a57", deep: "#02060f", mid: "#061a36", accent: GOLD };
const FILL = `radial-gradient(circle at 50% 30%, #0b2f63 0%, ${NIGHT.deep} 75%)`;

function Guides() {
  const t = CARD_BLEED;
  const s = CARD_BLEED + CARD_SAFE;
  return (
    <div className="wd-print-screen-only" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, border: `${t}px solid rgba(255, 0, 90, 0.28)` }} />
      <div style={{ position: "absolute", left: t, top: t, width: CARD_TRIM_W, height: CARD_TRIM_H, outline: "1px solid #00d0ff" }} />
      <div style={{ position: "absolute", left: s, top: s, right: s, bottom: s, outline: "1px dashed rgba(255, 120, 255, 0.9)" }} />
    </div>
  );
}

// The front. art: the draft card's image URL ("" while it draws); year.
export function CardFront({ art, year, guides }) {
  useDisplayFont();
  // Everything inside the safe area, with room to spare: the art (4:5, its
  // gold rule included) and the footer sit PAD inside the safe line.
  const PAD = 4;
  const inset = CARD_BLEED + CARD_SAFE + PAD;
  const w = CARD_W - inset * 2;
  const h = Math.round(w * 1.25);
  const bottom = CARD_BLEED + CARD_SAFE + PAD;
  return (
    <div className="wd-print-page" style={{ position: "relative", width: CARD_W, height: CARD_H, background: FILL, overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ position: "absolute", left: inset, top: inset, width: w, height: h, borderRadius: 6, overflow: "hidden", boxShadow: `0 0 0 1.5px ${GOLD}`, background: NIGHT.deep }}>
        {art && <img draggable={false} src={art} alt="" style={{ width: "100%", height: "100%", display: "block" }} />}
      </div>
      {/* The footer strip */}
      <div style={{ position: "absolute", left: inset, right: inset, top: inset + h + 6, bottom, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, borderTop: `1px solid ${GOLD}66` }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 13, letterSpacing: "0.05em", color: GOLD, lineHeight: 1, whiteSpace: "nowrap" }}>{year ? `${year} NFL Draft Prospect` : "NFL Draft Prospect"}</span>
        <span style={{ fontFamily: "Arial, sans-serif", fontSize: 5.5, fontWeight: 900, letterSpacing: "0.1em", color: "rgba(255,255,255,0.75)", whiteSpace: "nowrap" }}>WE-DRAFT.COM</span>
      </div>
      {guides && <Guides />}
    </div>
  );
}

// The back: ScoutCard's CardBack, inset so its frame lands inside the
// safe area; the rest of the bleed is the same dark ground.
export function CardBackPrint({ player, back, photo, logo, year, guides }) {
  const inset = CARD_BLEED + 6;
  return (
    <div className="wd-print-page" style={{ position: "relative", width: CARD_W, height: CARD_H, background: cardBackGround(NIGHT), overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ position: "absolute", left: inset, top: inset, right: inset, bottom: inset, containerType: "inline-size" }}>
        <CardBack bare theme={NIGHT} number={null} photo={photo} name={`${player.first} ${player.last}`.trim()} pos={player.pos} school={player.school} logo={logo}
          profile={back?.profile} stats={back?.stats || []} statsTitle="2026 Season" scout={back?.scout} year={year}
          footer={`We-Draft.com · ${year} NFL Draft`} />
      </div>
      {guides && <Guides />}
    </div>
  );
}
