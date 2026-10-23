// src/components/MockDraftKit.jsx
//
// Shared pieces for the legacy mock draft pages (MockDraftHub, MyMocksPage,
// ViewMock, CreateMock) — the hand-built, written mocks with an intro and
// pick-by-pick notes, as opposed to the coach-tendency simulator. Same page
// layout as DraftOrderPage.jsx: a centered column, top prospects / recent
// videos side columns when the window has room, and the NFL margin ads in
// the gutters outside both; phones get MobileAdCard in the content instead.
import { useEffect, useRef, useState } from "react";
import MarginAds, { useAdSelection, teamNameFromAbbr } from "./MarginAds";
import { MobileAdCard, MOBILE_AD_HEIGHT } from "./AdBanner";
import { TopProspectsRail, RecentVideosRail } from "./DraftSideRails";
import { viewportCssWidth } from "../utils/pageZoom";

export const BLUE = "#0055a5";
export const GOLD = "#f6a21d";
export const INK = "#1a1f2b";
export const MUTED = "#5f6b7a";
export const CARD_SHADOW = "0 2px 6px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2";
export const FONT = "'Arial Black', Arial, sans-serif";
export const BODY_FONT = "Arial, sans-serif";

// Limits for the editorial fields (CreateMock.jsx enforces them).
export const INTRO_MAX = 1200;
export const NOTE_MAX = 400;

const RAIL_WIDTH = 220;
const RAIL_GAP = 16;
const SIDE = RAIL_WIDTH + RAIL_GAP;

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}

// The page frame. width: the content column; year: the class for the top
// prospects rail. rails={false} drops the side columns (the editor needs the
// room) but keeps the margin ads.
export function MockPageShell({ width = 1000, year = "2027", rails: allowRails = true, isMobile, children }) {
  const fits = () => typeof window !== "undefined" && viewportCssWidth() >= width + 2 * SIDE + 32;
  const [showRails, setShowRails] = useState(fits);
  const contentRef = useRef(null);
  useEffect(() => {
    const onResize = () => setShowRails(fits());
    window.addEventListener("resize", onResize);
    window.addEventListener("pagezoomchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pagezoomchange", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);
  const rails = allowRails && showRails && !isMobile;

  return (
    <>
      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={rails ? 0 : 24} watch={[rails]} />
      <div ref={contentRef} style={{ position: "relative", maxWidth: rails ? width + 2 * SIDE : width, margin: "0 auto", padding: rails ? `0 ${SIDE}px` : 0, boxSizing: "border-box" }}>
        {rails && (
          <>
            <div style={{ position: "absolute", top: 24, bottom: 60, left: 0, width: RAIL_WIDTH }}>
              <div style={{ position: "sticky", top: 16 }}><TopProspectsRail year={year} /></div>
            </div>
            <div style={{ position: "absolute", top: 24, bottom: 60, right: 0, width: RAIL_WIDTH }}>
              <div style={{ position: "sticky", top: 16 }}><RecentVideosRail /></div>
            </div>
          </>
        )}
        <div style={{ maxWidth: width, margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 24px 60px", fontFamily: FONT }}>
          {children}
        </div>
      </div>
    </>
  );
}

// Blue hero card, same as DraftOrderPage's. actions sit top-right (wrap
// under the title on phones); children go under the title.
export function MockHero({ eyebrow, title, actions, isMobile, watermark, children }) {
  return (
    <div style={{
      position: "relative", borderRadius: 16, padding: isMobile ? "20px 16px" : "30px 32px", marginBottom: 18, overflow: "hidden",
      background: `linear-gradient(120deg, #00305c 0%, ${BLUE} 60%, #1d6fc0 100%)`, boxShadow: "0 10px 28px rgba(0,0,0,0.2)",
    }}>
      {watermark && !isMobile && (
        <div aria-hidden="true" style={{
          position: "absolute", top: "50%", right: -10, transform: "translateY(-50%)", fontSize: 150, fontWeight: 900,
          color: "rgba(255,255,255,0.06)", lineHeight: 1, pointerEvents: "none", whiteSpace: "nowrap",
        }}>{watermark}</div>
      )}
      <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 14 }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          {eyebrow && <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: GOLD }}>{eyebrow}</div>}
          <h1 style={{ margin: "6px 0 10px", fontSize: isMobile ? 26 : 40, fontWeight: 900, color: "#fff", textTransform: "uppercase", lineHeight: 1.05, letterSpacing: "0.01em", overflowWrap: "anywhere" }}>
            {title}
          </h1>
          {children}
        </div>
        {actions && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flexShrink: 0 }}>{actions}</div>}
      </div>
    </div>
  );
}

export const heroText = (isMobile) => ({
  margin: 0, maxWidth: 720, fontSize: isMobile ? 13 : 15, fontWeight: 600, color: "rgba(255,255,255,0.88)", lineHeight: 1.55, fontFamily: BODY_FONT,
});

export const heroPill = {
  display: "inline-block", padding: "4px 12px", borderRadius: 999, background: "rgba(255,255,255,0.14)",
  color: "#fff", fontSize: 12, fontWeight: 900, fontFamily: BODY_FONT,
};

// Filter chip (year, round) — DraftOrderPage's.
export const chip = (on, isMobile) => ({
  border: `2px solid ${on ? BLUE : "#d8dee8"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : "#3a4352",
  borderRadius: 999, padding: isMobile ? "6px 11px" : "7px 16px", fontFamily: "inherit", fontWeight: 900, fontSize: isMobile ? 12 : 13,
  letterSpacing: "0.05em", cursor: "pointer",
});

// kind: "gold" (primary on the hero), "ghost" (secondary on the hero),
// "blue" / "outline" / "danger" (on white).
const BUTTON_KINDS = {
  gold: { background: GOLD, color: "#fff", border: `2px solid ${GOLD}` },
  ghost: { background: "rgba(255,255,255,0.12)", color: "#fff", border: "2px solid rgba(255,255,255,0.45)" },
  blue: { background: BLUE, color: "#fff", border: `2px solid ${BLUE}` },
  outline: { background: "#fff", color: BLUE, border: "2px solid #d8dee8" },
  danger: { background: "#fff", color: "#b42318", border: "2px solid #f1c4bf" },
};
export const button = (kind, isMobile) => ({
  ...BUTTON_KINDS[kind],
  borderRadius: 999, padding: isMobile ? "8px 14px" : "9px 20px", fontFamily: FONT, fontWeight: 900, fontSize: isMobile ? 12 : 13,
  letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none",
  display: "inline-flex", alignItems: "center", gap: 6,
});

export function SectionTitle({ isMobile, children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, margin: "0 2px 12px" }}>
      <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 20, fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>{children}</h2>
      {right}
    </div>
  );
}

// Hover lift shared by the cards and pick rows.
export const MOCK_CARD_CSS = `
  .wd-mock-card { transition: transform 0.16s ease, box-shadow 0.16s ease; }
  .wd-mock-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.14) !important; }
  @media (prefers-reduced-motion: reduce) { .wd-mock-card, .wd-mock-card:hover { transition: none; transform: none; } }
`;

// The NFL Homage card for phones (MarginAds shows nothing there). Holds its
// height while the ad loads so the page doesn't jump.
export function PhoneAd({ isMobile, preferTeam = "" }) {
  const ad = useAdSelection({ enabled: isMobile, preferTeam });
  if (!isMobile) return null;
  return (
    <div style={{ margin: "4px 0 16px" }}>
      {ad.adData ? (
        <MobileAdCard
          ad={ad.adData}
          branding={ad.adTeamBranding}
          label={ad.adData.School || teamNameFromAbbr(ad.adData.Team)}
          allAds={ad.allAds}
          onPick={ad.setAdData}
          visible={ad.adVisible && ad.brandingReady}
        />
      ) : (
        <div aria-hidden="true" style={{ height: MOBILE_AD_HEIGHT + 17 }} />
      )}
    </div>
  );
}
