// src/components/PitchGraphic.jsx
//
// The mock player profile sent as an image with the Instagram outreach
// pitch (Admin → Social → Pitch Graphic). Two parts of a real player page,
// drawn at the page's own desktop proportions (PlayerProfile.js, the modern
// "wdm" look, measured on a live page: hero 798 × 194, grades card 750 wide
// and inset 24px under it, columns 210 / flex / flex / 150):
//   the hero    school colors, stripes and spotlight; on the left the
//               player's headshot over a faded team logo when they're in
//               the system with one, else the team logo; the name and
//               position · school · class in the middle; the jersey number
//               on the right (their real one when on file, else typed)
//   the grades  Community Grade, Top Strengths, Top Weaknesses, NFL Fits —
//               always the same sample: Early First Round; Instincts,
//               Explosiveness, Physicality; no weaknesses; three NFL teams
//               (random, re-rollable) — under a SAMPLE watermark
//   the footer  a white bar with the We-Draft.com logo
// Exported at 2x through utils/exportImages.js (renderShareImage), which
// inlines the logos.
import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import { gradeLook } from "../utils/gradeScale";
import WE_DRAFT_LOGO from "../assets/Logo1.png"; // the blue wordmark, for white

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";
const INK = "#0f1b2d";
const LINE = "#e3e8ef";   // card border (modern look)
const LINE_2 = "#eef1f5"; // dividers inside it
const HERO_W = 798;
const HERO_H = 194;
const PAD = 24;
const isHex = (h) => /^#[0-9a-f]{6}$/i.test(h || "");
export const PITCH_GRADE = "Early First Round";
export const PITCH_STRENGTHS = [["Instincts", 92], ["Explosiveness", 84], ["Physicality", 76]];

// The name's two lines at the hero's full size (58px), shrunk to fit the
// space between the logo and the number, as PlayerProfile.js's HeroName.
function FitName({ first, last }) {
  const box = useRef(null);
  const lines = useRef([]);
  const [size, setSize] = useState(58);
  useLayoutEffect(() => {
    setSize(58);
    requestAnimationFrame(() => {
      const avail = box.current?.clientWidth || 0;
      const widest = Math.max(...lines.current.filter(Boolean).map((el) => el.scrollWidth));
      if (avail && widest > avail * 0.98) setSize(Math.max(26, Math.floor(58 * (avail * 0.98) / widest)));
    });
  }, [first, last]);
  return (
    <div ref={box} style={{ width: "100%", fontWeight: 900, textTransform: "uppercase", color: "#fff", letterSpacing: "-0.005em", lineHeight: 1, textShadow: "0 2px 8px rgba(0,0,0,0.4)", fontSize: size }}>
      {[first, last].map((w, i) => (
        <div key={i} style={{ marginTop: i ? 4 : 0, whiteSpace: "nowrap" }}>
          <span ref={(el) => { lines.current[i] = el; }} style={{ display: "inline-block" }}>{w}</span>
        </div>
      ))}
    </div>
  );
}

// In-card headings, as the modern page's eyebrows: 12px site blue, no rule.
const Heading = ({ children, center, gap = 12 }) => (
  <h3 style={{ margin: `0 0 ${gap}px`, color: SITE_BLUE, fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.14em", whiteSpace: "nowrap", textAlign: center ? "center" : "left" }}>
    {children}
  </h3>
);

// person: { First, Last, Position, School, Eligible }; brand: the school's
// schools doc (Color1, Color2, Logo1, LogoDark, Wordmark, WordmarkDark);
// fits: [{ abbr, logo }]; headshot: the player's photo (playerPhotos/{id})
// when they're in the system — it takes the left side, the logo fading in
// behind it.
const PitchGraphic = forwardRef(function PitchGraphic({ person, brand, number, fits, headshot }, ref) {
  const c1 = isHex(brand?.Color1) ? brand.Color1 : SITE_BLUE;
  const c2 = isHex(brand?.Color2) ? brand.Color2 : SITE_GOLD;
  const logo = brand?.LogoDark || brand?.Logo1 || "";
  const wordmark = brand?.WordmarkDark || brand?.Wordmark || "";
  const num = String(number || "").replace(/^#/, "").trim();
  const look = gradeLook(PITCH_GRADE);
  return (
    <div ref={ref} style={{ width: HERO_W + PAD * 2, padding: PAD, background: "#f7f9fc", boxSizing: "border-box", fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" }}>
      {/* ── Hero ── */}
      <div style={{
        position: "relative", overflow: "hidden", borderRadius: 16, width: HERO_W, height: HERO_H,
        background: [
          `radial-gradient(circle 220px at top left, ${c2}55, transparent 100%)`,
          `radial-gradient(circle 220px at bottom right, ${c2}55, transparent 100%)`,
          "linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4))",
          `linear-gradient(120deg, ${c1} 0%, ${c1} 55%, ${c2} 100%)`,
        ].join(", "),
      }}>
        <div style={{ position: "absolute", inset: "-20%", background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 2px, transparent 2px, transparent 40px)" }} />
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.16), transparent 55%)" }} />
        {/* As the real page: the faded wordmark only when there's no number on that side. */}
        {wordmark && !num && (
          <img src={wordmark} alt="" style={{ position: "absolute", top: "50%", right: "-4%", transform: "translateY(-50%)", width: "55%", maxWidth: 520, height: "auto", objectFit: "contain", opacity: 0.14 }} />
        )}
        {headshot ? (
          <>
            {/* As the real page with a headshot: the team logo faded behind
                it, the headshot standing on the hero's bottom edge. */}
            {logo && (
              <img src={logo} alt="" style={{ position: "absolute", top: "50%", left: "calc(2% + 125px)", transform: "translate(-50%, -50%)", height: "150%", width: "auto", maxWidth: "40%", objectFit: "contain", opacity: 0.13 }} />
            )}
            <img src={headshot} alt="" style={{ position: "absolute", bottom: 0, left: "2%", height: "92%", width: "auto", maxWidth: 260, objectFit: "contain", objectPosition: "bottom", zIndex: 2 }} />
          </>
        ) : logo && (
          <img src={logo} alt="" style={{ position: "absolute", top: "50%", left: "3%", transform: "translateY(-50%)", height: "70%", width: "auto", maxWidth: 220, objectFit: "contain", filter: "drop-shadow(0 4px 14px rgba(0,0,0,0.45))", zIndex: 2 }} />
        )}
        {num && (
          <div style={{
            position: "absolute", top: 0, bottom: 0, right: 0, width: "32%", paddingLeft: 36, boxSizing: "border-box", zIndex: 2,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Arial Black', 'Helvetica Neue', Arial, sans-serif", fontWeight: 900, color: "#fff",
            textShadow: `0 4px 18px rgba(0,0,0,0.45), 3px 3px 0 ${c2}`,
          }}>
            <span style={{ position: "relative", display: "block", lineHeight: 0.82, letterSpacing: "-0.04em", fontSize: num.length > 1 ? 120 : 160 }}>
              <span style={{ position: "absolute", right: "100%", top: 6, marginRight: 4, fontSize: 44, lineHeight: 1, letterSpacing: 0, opacity: 0.85 }}>#</span>
              {num}
            </span>
          </div>
        )}
        <div style={{ position: "relative", zIndex: 1, height: "100%", boxSizing: "border-box", padding: "20px 28% 10px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          <FitName first={person.First} last={person.Last} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 8, minHeight: 36, whiteSpace: "nowrap" }}>
            <span style={{ border: "1px solid rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.1)", color: "#fff", borderRadius: 999, fontWeight: 800, fontSize: 17, letterSpacing: "0.05em", padding: "3px 16px" }}>{person.Position}</span>
            <span style={{ color: "rgba(255,255,255,0.4)" }}>·</span>
            <span style={{ color: "#fff", fontWeight: 800, fontSize: 19, textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}>{person.School}</span>
            <span style={{ color: "rgba(255,255,255,0.4)" }}>·</span>
            <span style={{ color: "rgba(255,255,255,0.8)", fontWeight: 700, fontSize: 19 }}>{person.Eligible}</span>
          </div>
        </div>
      </div>

      {/* ── Draft grades (the page's card: 750 wide, inset 24px), under a SAMPLE watermark ── */}
      <div style={{ position: "relative", margin: `${PAD}px ${PAD}px 0`, display: "flex", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ flex: "0 0 210px", padding: "20px 24px", borderRight: `1px solid ${LINE_2}`, display: "flex", flexDirection: "column", alignItems: "center", boxSizing: "border-box" }}>
          <div style={{ width: "100%" }}><Heading center gap={16}>Community Grade</Heading></div>
          <div style={{ background: look.bg, borderRadius: 12, padding: "10px 14px", width: 110, textAlign: "center", boxSizing: "border-box" }}>
            <div style={{ fontSize: 36, fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.02em" }}>{look.short}</div>
            <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.8)", textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 3 }}>{PITCH_GRADE}</div>
          </div>
          <div style={{ marginTop: 16, width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 9, fontWeight: 800, color: "#bbb", letterSpacing: "0.06em", textTransform: "uppercase" }}><span>1st Rd</span><span>UDFA</span></div>
            <div style={{ height: 8, background: "#eee", borderRadius: 4, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 0, width: "8%", height: "100%", background: look.bg, borderRadius: 4 }} />
            </div>
          </div>
        </div>
        <div style={{ flex: 1, padding: 20, borderRight: `1px solid ${LINE_2}` }}>
          <Heading>Top Strengths</Heading>
          {PITCH_STRENGTHS.map(([term, pct], i) => (
            <div key={term} style={{ padding: "8px 0", borderBottom: i < PITCH_STRENGTHS.length - 1 ? `1px solid ${LINE_2}` : "none" }}>
              <div style={{ fontWeight: 900, textTransform: "uppercase", fontSize: 14, color: INK, letterSpacing: "0.06em" }}>{term}</div>
              <div style={{ height: 4, background: "#eee", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "#16a34a", borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: 20, borderRight: `1px solid ${LINE_2}` }}>
          <Heading>Top Weaknesses</Heading>
          <p style={{ margin: 0, fontStyle: "italic", color: "#9ca3af", fontSize: 14 }}>None</p>
        </div>
        <div style={{ flex: "0 0 150px", padding: 20, display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
          <Heading>NFL Fits</Heading>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            {fits.map((f) => f.logo
              ? <img key={f.abbr} src={f.logo} alt={f.abbr} style={{ width: 80, height: 80, objectFit: "contain" }} />
              : <span key={f.abbr} style={{ height: 80, display: "flex", alignItems: "center", fontWeight: 900, color: "#9aa5b4" }}>{f.abbr}</span>)}
          </div>
        </div>
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 3 }}>
          <span style={{ transform: "rotate(-12deg)", fontSize: 120, fontWeight: 900, letterSpacing: "0.18em", color: "rgba(15,23,42,0.12)", textTransform: "uppercase", whiteSpace: "nowrap", fontFamily: "'Arial Black', Arial, sans-serif" }}>
            Sample
          </span>
        </div>
      </div>

      {/* ── We-Draft.com bar: full width across the bottom ── */}
      <div style={{ margin: `${PAD}px -${PAD}px -${PAD}px`, background: "#fff", borderTop: `1px solid ${LINE}`, padding: "14px 0", display: "flex", justifyContent: "center", alignItems: "center" }}>
        <img src={WE_DRAFT_LOGO} alt="We-Draft.com" style={{ height: 30, width: "auto" }} />
      </div>
    </div>
  );
});

export default PitchGraphic;
