// src/components/AdBanner.js
//
// In-content Homage banner — the horizontal companion to the margin rail
// cards (MarginAds.js / PlayerProfile.js). No product shots: it's built
// from the team's own wordmark and colors, so it reads as part of the page
// rather than a pasted-in display ad. It shows whatever ad the rails have
// selected (the caller passes the same `ad` + team branding), so picking a
// team in the rail's NFL grid restyles this too.
//
// MobileAdCard (below) is the phone version, in the same spot — phones get
// no rails, so it carries its own team dropdown and the ad's first product
// shot (Image1) beside the same team-colored panel.
//
// branding: nfl doc fields (Color1, Color2, Wordmark, WordmarkDark, Logo1,
// LogoDark, Team) for an NFL ad, or the school's equivalents (+ Mascot) for
// a CFB one. Everything degrades: no wordmark → logo + name, no colors →
// site blue/gold.
import { useLayoutEffect, useRef, useState } from "react";
import HomageLogo from "../assets/homagelogo.png";
import { sanitizeUrl, isCfbAd, NFL_TEAM_ABBRS, teamNameFromAbbr } from "./MarginAds";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

function luminance(hex) {
  const n = parseInt(String(hex || "").replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  if (Number.isNaN(n)) return 0;
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// Headline (and subline) that shrinks to fit its column instead of cutting off ("Throwback
// Commanders Gear" in a narrow content column): steps the font down from
// max toward min until it fits on one line; if even min won't, it wraps to
// two lines at wrapSize instead (two readable lines beat one tiny one).
// Re-fits only when the column's *width* changes, a frame later — re-fitting
// can change the banner's height, and reacting to that would loop.
function FitHeadline({ text, max, min, wrapSize = max, style }) {
  const ref = useRef(null);
  const [fit, setFit] = useState({ size: max, wrap: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      el.style.whiteSpace = "nowrap";
      let s = max;
      el.style.fontSize = `${s}px`;
      while (s > min && el.scrollWidth > el.clientWidth) {
        s -= 1;
        el.style.fontSize = `${s}px`;
      }
      const wrap = el.scrollWidth > el.clientWidth;
      const size = wrap ? wrapSize : s;
      el.style.whiteSpace = wrap ? "normal" : "nowrap";
      el.style.fontSize = `${size}px`;
      setFit((prev) => (prev.size === size && prev.wrap === wrap ? prev : { size, wrap }));
    };
    measure();
    let lastWidth = el.parentElement.clientWidth;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      const w = el.parentElement.clientWidth;
      if (w === lastWidth) return;
      lastWidth = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(el.parentElement);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [text, max, min, wrapSize]);
  return (
    <div ref={ref} style={{ ...style, fontSize: `${fit.size}px`, whiteSpace: fit.wrap ? "normal" : "nowrap", overflow: "hidden" }}>
      {text}
    </div>
  );
}

const BANNER_CSS = `
  .wd-ad-banner { display:block; text-decoration:none; position:relative; overflow:hidden; border-radius:14px;
    transition: transform 0.2s ease, box-shadow 0.2s ease; }
  .wd-ad-banner:hover { transform: translateY(-2px); }
  .wd-ad-banner .wd-ad-banner-shine { position:absolute; top:0; left:-45%; width:30%; height:100%; pointer-events:none; z-index:2;
    background: linear-gradient(115deg, transparent, rgba(255,255,255,0.22), transparent); transform: skewX(-20deg); }
  .wd-ad-banner:hover .wd-ad-banner-shine { animation: wdAdBannerShine 0.9s ease forwards; }
  @keyframes wdAdBannerShine { to { left: 120%; } }
  .wd-ad-banner .wd-ad-banner-arrow { display:inline-block; transition: transform 0.2s ease; }
  .wd-ad-banner:hover .wd-ad-banner-arrow { transform: translateX(4px); }
  .wd-ad-banner .wd-ad-banner-mark { transition: transform 0.35s ease; }
  .wd-ad-banner:hover .wd-ad-banner-mark { transform: scale(1.04); }
`;

// Colors, marks and copy for one ad — shared by AdBanner and MobileAdCard.
function bannerTheme(ad, branding, label) {
  const cfb = isCfbAd(ad);
  let c1 = branding?.Color1 || SITE_BLUE;
  let c2 = branding?.Color2 || SITE_GOLD;
  // A near-white primary can't carry white type — lead with the secondary.
  if (luminance(c1) > 0.8) [c1, c2] = [luminance(c2) > 0.8 ? "#111111" : c2, c1];
  const nickname = cfb
    ? (branding?.Mascot || label)
    : (branding?.Team || label.split(" ").pop());
  return {
    c1, c2,
    wordmark: branding?.WordmarkDark || branding?.Wordmark || "",
    logo: branding?.LogoDark || branding?.Logo1 || "",
    kicker: cfb ? "Officially Licensed College Apparel" : "Officially Licensed NFL Apparel",
    headline: `Throwback ${nickname} Gear`,
    sub: cfb
      ? `Vintage ${label} tees, hoodies & hats`
      : "Vintage tees, hoodies & hats · All 32 NFL teams",
  };
}

const img = (src, style, alt = "") => (
  <img src={sanitizeUrl(src)} alt={alt} loading="lazy" referrerPolicy="no-referrer"
    onError={(e) => { e.currentTarget.style.display = "none"; }} style={style} />
);

export default function AdBanner({ ad, branding, label, isMobile, visible = true }) {
  if (!ad?.Link) return null;
  const { c1, c2, wordmark, logo, kicker, headline, sub } = bannerTheme(ad, branding, label);

  return (
    <div style={{ opacity: visible ? 1 : 0, transition: "opacity 0.7s ease" }}>
      <style>{BANNER_CSS}</style>
      <div style={{ fontSize: "9px", fontWeight: 800, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: "6px", textAlign: "right" }}>
        Sponsored
      </div>
      <a
        href={sanitizeUrl(ad.Link)}
        target="_blank"
        rel="sponsored noopener noreferrer"
        className="wd-ad-banner"
        aria-label={`Shop ${label} throwback gear at Homage`}
        style={{
          background: `linear-gradient(110deg, ${c1} 0%, ${c1} 52%, ${c1}dd 100%)`,
          boxShadow: `0 6px 22px ${c1}40`,
          fontFamily: "'Arial Black', Arial, sans-serif",
        }}
      >
        {/* Texture + depth: fine diagonal pinstripes, a soft spotlight
            behind the wordmark, and the team mark oversized and faded,
            bleeding off the right edge. */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
          background: "repeating-linear-gradient(135deg, rgba(255,255,255,0.045) 0 2px, transparent 2px 14px)" }} />
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse at 18% 50%, rgba(255,255,255,0.18), transparent 55%)" }} />
        {logo && img(logo, {
          position: "absolute", right: isMobile ? "-12%" : "16%", top: "50%", height: "190%",
          transform: "translateY(-50%) rotate(-10deg)", opacity: 0.12, pointerEvents: "none",
        })}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "5px", background: c2 }} />
        <div className="wd-ad-banner-shine" />

        <div style={{
          position: "relative", zIndex: 1, display: "flex", alignItems: "center",
          gap: isMobile ? "12px" : "28px",
          padding: isMobile ? "14px 14px 17px" : "20px 28px 23px",
          minHeight: isMobile ? "74px" : "108px",
        }}>
          {/* Wordmark (or logo + name when the team has none) */}
          <div className="wd-ad-banner-mark" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "10px", maxWidth: isMobile ? "34%" : "32%" }}>
            {wordmark ? (
              img(wordmark, { display: "block", maxWidth: "100%", height: isMobile ? "34px" : "58px", objectFit: "contain", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.25))" }, label)
            ) : (
              <>
                {logo && img(logo, { display: "block", height: isMobile ? "38px" : "64px", objectFit: "contain", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.25))" }, label)}
                {!isMobile && (
                  <div style={{ color: "#fff", fontSize: "18px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.05 }}>
                    {label}
                  </div>
                )}
              </>
            )}
          </div>

          {!isMobile && <div style={{ width: "2px", alignSelf: "stretch", background: c2, opacity: 0.85, borderRadius: "2px", flexShrink: 0 }} />}

          {/* Copy */}
          <div style={{ flex: 1, minWidth: 0, color: "#fff" }}>
            {!isMobile && (
              <div style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", opacity: 0.8, marginBottom: "4px" }}>
                {kicker}
              </div>
            )}
            <FitHeadline
              text={headline}
              max={isMobile ? 15 : 24}
              min={isMobile ? 13 : 15}
              wrapSize={isMobile ? 14 : 18}
              style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.05, textShadow: "0 2px 8px rgba(0,0,0,0.25)" }}
            />
            <FitHeadline
              text={sub}
              max={isMobile ? 10 : 13}
              min={isMobile ? 9 : 11}
              wrapSize={isMobile ? 10 : 12}
              style={{ fontFamily: "Arial, sans-serif", fontWeight: 700, opacity: 0.85, marginTop: "5px", lineHeight: 1.25 }}
            />
          </div>

          {/* CTA + Homage mark */}
          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: isMobile ? "6px" : "9px" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              background: "#fff", color: c1,
              fontSize: isMobile ? "10px" : "13px", fontWeight: 900,
              padding: isMobile ? "7px 12px" : "11px 22px", borderRadius: "999px",
              textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
              boxShadow: `0 3px 0 ${c2}, 0 6px 14px rgba(0,0,0,0.2)`,
            }}>
              Shop Now <span className="wd-ad-banner-arrow">→</span>
            </span>
            <img src={HomageLogo} alt="Homage" loading="lazy"
              style={{ height: isMobile ? "9px" : "12px", objectFit: "contain", filter: "brightness(0) invert(1)", opacity: 0.9 }} />
          </div>
        </div>
      </a>
    </div>
  );
}

// ── Phone version: the ad's first product shot (Image1) on the left, the
// same team-colored panel on the right, and a compact dropdown of NFL team
// codes in place of the rails' 32-logo grid (allAds = NFL ads only, so a
// school default isn't in it — the pill reads "NFL" while one's showing).
// The dropdown is a real <select> laid invisibly over the pill, so phones
// open their native picker; it sits outside both links, since a control
// inside an <a> is invalid and swallows the tap. Fixed height
// (MOBILE_AD_HEIGHT) so the caller can hold the exact space while it loads. ──
export const MOBILE_AD_HEIGHT = 158;
const MOBILE_IMG_WIDTH = Math.round(MOBILE_AD_HEIGHT * (1600 / 1920));

export function MobileAdCard({ ad, branding, label, allAds = [], onPick, visible = true }) {
  if (!ad?.Link) return null;
  const { c1, c2, wordmark, logo, headline } = bannerTheme(ad, branding, label);
  const href = sanitizeUrl(ad.Link);
  const teams = NFL_TEAM_ABBRS.filter((abbr) => allAds.some((a) => a.Team === abbr));
  const current = isCfbAd(ad) ? "" : ad.Team || "";

  return (
    <div style={{ opacity: visible ? 1 : 0, transition: "opacity 0.7s ease" }}>
      <div style={{ fontSize: "9px", fontWeight: 800, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: "6px", textAlign: "right" }}>
        Sponsored
      </div>
      <div style={{
        position: "relative", display: "flex", height: `${MOBILE_AD_HEIGHT}px`,
        borderRadius: "14px", overflow: "hidden", background: c1,
        boxShadow: `0 6px 18px ${c1}40`, border: `2px solid ${c1}`,
        fontFamily: "'Arial Black', Arial, sans-serif",
      }}>
        {/* Product shot */}
        <a href={href} target="_blank" rel="sponsored noopener noreferrer" aria-label={`Shop ${label} gear at Homage`}
          style={{ flexShrink: 0, width: `${MOBILE_IMG_WIDTH}px`, height: "100%", background: "#fafafa", display: "block" }}>
          {ad.Image1 && img(ad.Image1, { width: "100%", height: "100%", objectFit: "cover", display: "block" }, `${label} throwback gear`)}
        </a>

        {/* Team panel */}
        <div style={{ position: "relative", flex: 1, minWidth: 0, overflow: "hidden", borderLeft: `3px solid ${c2}`,
          background: `linear-gradient(160deg, ${c1} 0%, ${c1} 60%, ${c1}dd 100%)` }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
            background: "repeating-linear-gradient(135deg, rgba(255,255,255,0.045) 0 2px, transparent 2px 12px)" }} />
          {logo && img(logo, {
            position: "absolute", right: "-22%", bottom: "-18%", height: "95%",
            transform: "rotate(-10deg)", opacity: 0.12, pointerEvents: "none",
          })}

          <a href={href} target="_blank" rel="sponsored noopener noreferrer"
            style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", padding: "11px 12px", boxSizing: "border-box", textDecoration: "none", color: "#fff" }}>
            {/* Wordmark row — right side left clear for the team pill */}
            <div style={{ display: "flex", alignItems: "center", height: "32px", paddingRight: "64px" }}>
              {wordmark
                ? img(wordmark, { display: "block", maxWidth: "100%", height: "32px", objectFit: "contain", objectPosition: "left center", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.25))" }, label)
                : logo && img(logo, { display: "block", height: "32px", objectFit: "contain" }, label)}
            </div>
            <FitHeadline
              text={headline}
              max={17}
              min={13}
              wrapSize={15}
              style={{ marginTop: "6px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.08, textShadow: "0 2px 6px rgba(0,0,0,0.25)" }}
            />
            <div style={{ fontFamily: "Arial, sans-serif", fontSize: "10px", fontWeight: 700, opacity: 0.85, marginTop: "4px" }}>
              Officially licensed · Homage
            </div>
            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: "5px",
                background: "#fff", color: c1, fontSize: "11px", fontWeight: 900,
                padding: "7px 14px", borderRadius: "999px", textTransform: "uppercase", letterSpacing: "0.05em",
                boxShadow: `0 2px 0 ${c2}, 0 4px 10px rgba(0,0,0,0.2)`, whiteSpace: "nowrap",
              }}>
                Shop Now →
              </span>
              <img src={HomageLogo} alt="Homage" style={{ height: "9px", objectFit: "contain", filter: "brightness(0) invert(1)", opacity: 0.85 }} />
            </div>
          </a>

          {/* Team dropdown — outside the link (see above). */}
          {teams.length > 0 && onPick && (
            <div style={{ position: "absolute", top: "10px", right: "10px", zIndex: 2 }}>
              <span aria-hidden="true" style={{
                display: "inline-flex", alignItems: "center", gap: "4px",
                background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.55)", color: "#fff",
                fontSize: "11px", fontWeight: 900, letterSpacing: "0.06em",
                padding: "5px 8px 5px 10px", borderRadius: "999px", whiteSpace: "nowrap",
              }}>
                {current || "NFL"} <span style={{ fontSize: "8px", opacity: 0.85 }}>▼</span>
              </span>
              <select
                value={current}
                onChange={(e) => {
                  const next = allAds.find((a) => a.Team === e.target.value);
                  if (next) onPick(next);
                }}
                aria-label="Choose an NFL team"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", fontSize: "16px" }}
              >
                {!current && <option value="" disabled>NFL</option>}
                {teams.map((abbr) => <option key={abbr} value={abbr} title={teamNameFromAbbr(abbr)}>{abbr}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
