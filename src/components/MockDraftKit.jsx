// src/components/MockDraftKit.jsx
//
// Shared pieces for the legacy mock draft pages (MockDraftHub, MyMocksPage,
// ViewMock, CreateMock) — the hand-built, written mocks with an intro and
// pick-by-pick notes, as opposed to the coach-tendency simulator. Same page
// layout as DraftOrderPage.jsx: a centered column, top prospects / recent
// videos side columns when the window has room, and the NFL margin ads in
// the gutters outside both; phones get MobileAdCard in the content instead.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import MarginAds, { useAdSelection, teamNameFromAbbr } from "./MarginAds";
import { MobileAdCard, MOBILE_AD_HEIGHT } from "./AdBanner";
import { TopProspectsRail, RecentVideosRail } from "./DraftSideRails";
import DraftNowButton from "./DraftNowButton";
import { SIM_YEAR } from "../utils/draftSim/years";
import { viewportCssWidth } from "../utils/pageZoom";
import { NFL_TEAMS, NFL_TEAM_ABBRS } from "../utils/coachHistory";
import { weeklyMockHref } from "../utils/weeklyMockNews";
import { textOn } from "../utils/teamColors";
import verifiedBadge from "../assets/verified.png";

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
// room) but keeps the margin ads. leftRail: a column of the page's own in
// place of the top prospects (the weekly mock's team pages: every team).
export function MockPageShell({ width = 1000, year = "2027", rails: allowRails = true, leftRail = null, isMobile, children }) {
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
              <div style={{ position: "sticky", top: 16 }}>{leftRail || <TopProspectsRail year={year} />}</div>
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

// The Weekly Mock's header (its team pages, WeeklyTeamMock.jsx, and the
// full mock, ViewMock.js), read like an article's: a logo (to its page,
// when there's one) beside the date, a kicker and the title — one line,
// shrunk to fit (FitLine) — then a summary and the byline, in the hero's
// colors with its wordmark faded behind. hero: { c1, c2 (the background),
// ink (text), accent (date badge, kicker, bottom edge), logo, logoTitle,
// href, wordmark }. actions sit top-right, like MockHero's — on phones, a
// row of their own under the title, which wraps there instead of shrinking.
export function ArticleHero({ hero, isMobile, kicker, headline, dek, date, byline, actions }) {
  const logoSize = isMobile ? 56 : 88;
  return (
    <header style={{
      position: "relative", overflow: "hidden", borderRadius: 16, marginBottom: 14, padding: isMobile ? "18px 16px" : "26px 30px",
      background: `linear-gradient(120deg, ${hero.c1} 0%, ${hero.c1} 62%, ${hero.c2} 140%)`, color: hero.ink, boxShadow: "0 10px 28px rgba(0,0,0,0.2)",
      ...(hero.accent ? { borderBottom: `5px solid ${hero.accent}` } : {}),
    }}>
      {hero.wordmark && (
        <img src={hero.wordmark} alt="" aria-hidden="true" style={{
          position: "absolute", right: isMobile ? -24 : 8, top: "50%", transform: "translateY(-50%)", height: isMobile ? 90 : 150,
          maxWidth: "62%", objectFit: "contain", opacity: 0.12, pointerEvents: "none",
        }} />
      )}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: isMobile ? 14 : 22 }}>
        {hero.logo && (
          <Link to={hero.href} title={hero.logoTitle} style={{ flexShrink: 0, lineHeight: 0 }}>
            <img src={hero.logo} alt={hero.logoTitle} style={{ width: logoSize, height: logoSize, objectFit: "contain", filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.3))" }} />
          </Link>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {date && (
              <span style={{
                display: "inline-block", borderRadius: 6, padding: isMobile ? "3px 8px" : "4px 10px", background: hero.accent || hero.ink, color: hero.c1,
                fontSize: isMobile ? 12 : 14, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: BODY_FONT,
              }}>{date}</span>
            )}
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", ...(hero.accent ? { color: hero.accent } : { opacity: 0.8 }) }}>{kicker}</span>
          </div>
          <h1 style={{ margin: "6px 0 0", fontWeight: 900, lineHeight: 1.15, letterSpacing: "-0.01em", ...(isMobile ? { fontSize: 22, overflowWrap: "anywhere" } : {}) }}>
            {isMobile ? headline : <FitLine max={34} min={14}>{headline}</FitLine>}
          </h1>
        </div>
        {actions && !isMobile && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flexShrink: 0, alignSelf: "flex-start" }}>{actions}</div>}
      </div>
      {actions && isMobile && <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>{actions}</div>}
      {dek && <p style={{ position: "relative", margin: isMobile ? "12px 0 0" : "14px 0 0", maxWidth: 640, fontSize: isMobile ? 15 : 17, lineHeight: 1.5, fontFamily: "Georgia, 'Times New Roman', serif", opacity: 0.95 }}>{dek}</p>}
      {byline && <div style={{ position: "relative", marginTop: 10, fontSize: 12, fontWeight: 700, fontFamily: BODY_FONT, opacity: 0.9 }}>{byline}</div>}
    </header>
  );
}

// Text kept to one line: the biggest font size from max down to min that
// fits its box, measured again whenever the box resizes.
function FitLine({ max, min, children }) {
  const ref = useRef(null);
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      let s = max;
      el.style.fontSize = `${s}px`;
      while (s > min && el.scrollWidth > el.clientWidth) { s -= 1; el.style.fontSize = `${s}px`; }
      setSize(s);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [max, min, children]);
  return <span ref={ref} style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: size }}>{children}</span>;
}

// Breadcrumbs over a page's header — items: [{ name, href }], the last
// one this page (not a link). Its BreadcrumbList JSON-LD (breadcrumbLd)
// lists the same items, so the markup matches what's on the page.
export function Breadcrumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb" style={{ marginBottom: 10, fontSize: 12, fontWeight: 700, fontFamily: BODY_FONT, color: MUTED }}>
      <ol style={{ display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", margin: 0, padding: 0 }}>
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={it.href} style={{ display: "flex", gap: 6 }}>
              {last
                ? <span aria-current="page" style={{ color: INK }}>{it.name}</span>
                : <Link to={it.href} style={{ color: BLUE, textDecoration: "none" }}>{it.name}</Link>}
              {!last && <span aria-hidden="true">›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
export const breadcrumbLd = (items, site = "https://we-draft.com") => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${site}${it.href}` })),
});
// The site as a publisher, for a page's JSON-LD (NewsArticle.jsx's).
export const SITE_PUBLISHER = { "@type": "Organization", name: "We-Draft", url: "https://we-draft.com", logo: { "@type": "ImageObject", url: "https://we-draft.com/logo512.png" } };

// The Weekly Mock's byline: posted as We-Draft.com, with the site's
// verified badge, made by the Draft Sim.
export function WeeklyByline() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      {/* The dot stays with the name, so a phone's wrap doesn't start a line with it. */}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
        By <strong style={{ fontWeight: 900 }}>We-Draft.com</strong>
        <img src={verifiedBadge} alt="Verified" title="Verified" style={{ width: 15, height: 15, objectFit: "contain" }} /> ·
      </span>
      <span>Generated by the <Link to="/draftsim" style={{ color: "inherit", fontWeight: 900 }}>We-Draft.com Draft Sim</Link></span>
    </span>
  );
}

// The Weekly Mock's switch between classes, in a hero's actions: one pill a
// class (years — the published ones, this one included), this one filled.
// hrefOf(year): that class's page. ink / bg: the hero's text and background.
export function WeeklyYearSwitch({ years, current, hrefOf, ink, bg, isMobile }) {
  if (years.length < 2) return null;
  return (
    <nav aria-label="Mock draft year" style={{ display: "flex", gap: 6, ...(isMobile ? { flex: "1 1 100%" } : {}) }}>
      {years.map((y) => {
        const on = y === current;
        return (
          <Link key={y} to={hrefOf(y)} aria-current={on ? "page" : undefined} style={{
            borderRadius: 999, padding: isMobile ? "6px 12px" : "8px 16px", fontSize: isMobile ? 11 : 12, fontWeight: 900, letterSpacing: "0.06em",
            textTransform: "uppercase", textDecoration: "none", whiteSpace: "nowrap", ...(isMobile ? { flex: 1, textAlign: "center" } : {}),
            background: on ? ink : "transparent", color: on ? bg : ink, border: `2px solid ${ink}`,
          }}>{on ? `${y} Mock` : `Show ${y} Mock →`}</Link>
        );
      })}
    </nav>
  );
}

// Every team's Weekly Mock page (/mocks/{team}, WeeklyTeamMock.jsx): the
// left rail on desktop, the bottom of the page on phones. A grid of logos,
// this team's marked (current — none on the full mock), then a link
// (full: { href, label } — the team pages' to the full mock). teams: NFL
// branding. columns: 8 across a phone's full width.
export function TeamMocksRail({ current = "", year, teams, full = null, columns = 4 }) {
  const all = [...NFL_TEAM_ABBRS].sort((a, b) => (NFL_TEAMS[a] || a).localeCompare(NFL_TEAMS[b] || b));
  return (
    <div style={{ background: "#fff", borderRadius: 14, boxShadow: CARD_SHADOW, padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>{year} Team Mock Drafts</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 4 }}>
        {all.map((t) => {
          const b = teams[t] || {};
          const on = t === current;
          return (
            <Link key={t} to={weeklyMockHref(t, year)} title={`${NFL_TEAMS[t] || t} ${year} mock draft`} aria-current={on ? "page" : undefined} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 2px", borderRadius: 8, textDecoration: "none",
              background: on ? "#eef3fa" : "transparent", outline: on ? `2px solid ${BLUE}` : "none",
            }}>
              {b.Logo1 ? <img src={b.Logo1} alt="" style={{ width: 28, height: 28, objectFit: "contain" }} /> : <span style={{ height: 28 }} />}
              <span style={{ fontSize: 9, fontWeight: 900, color: on ? BLUE : "#5f6b7a" }}>{t}</span>
            </Link>
          );
        })}
      </div>
      {full && (
        <Link to={full.href} style={{
          display: "block", marginTop: 10, padding: "9px 10px", borderRadius: 8, background: BLUE, color: "#fff", textDecoration: "none",
          fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", textAlign: "center",
        }}>{full.label} →</Link>
      )}
    </div>
  );
}

// The sim, for anyone who'd draft it differently: "Don't like the picks?"
// with the Draft button, on the page's colors. team/nick: draft as that
// team (its weekly mock page); none: the sim's own start (the full mock).
// year: a class other than the sim's default (2028's pages). margin: its
// own spacing (under the hero by default; between picks, set by the page).
// Phones: the button in the middle, "Don't like / the picks?" stacked on
// its left and "Make your / own!" on its right, a size up so the two
// halves match.
export function MakeYourOwnBanner({ team = "", teamName = "", nick = "", year = "", c1, c2, ink, isMobile, margin = "0 0 18px" }) {
  const draftButton = <DraftNowButton team={team} teamName={teamName} year={year && year !== SIM_YEAR ? year : ""} c1={c1} c2={c2} isMobile={isMobile} compact />;
  if (isMobile) {
    const half = { fontWeight: 900, lineHeight: 1.1, minWidth: 0 };
    return (
      <div style={{
        display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10, margin,
        background: `linear-gradient(120deg, ${c1} 0%, ${c1} 55%, ${c2} 130%)`, color: ink, borderRadius: 14,
        boxShadow: "0 6px 18px rgba(0,0,0,0.16)", padding: "12px 12px",
      }}>
        <span style={{ ...half, fontSize: 15, textAlign: "right" }}>Don&apos;t like<br />the picks?</span>
        {draftButton}
        <span style={{ ...half, fontSize: 19, textAlign: "left" }}>Make your<br />own!</span>
      </div>
    );
  }
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", margin,
      background: `linear-gradient(120deg, ${c1} 0%, ${c1} 55%, ${c2} 130%)`, color: ink, borderRadius: 14,
      boxShadow: "0 6px 18px rgba(0,0,0,0.16)", padding: isMobile ? "14px 16px" : "16px 24px",
    }}>
      <span style={{ fontSize: isMobile ? 17 : 21, fontWeight: 900 }}>
        Don&apos;t like the picks? {nick ? `Draft as the ${nick} and make your own!` : "Make your own!"}
      </span>
      {draftButton}
    </div>
  );
}

// A pick in a trade card's chips (a saved trade's: { year, round, original,
// overall — null for a later draft's }): "No. 9" over "2027 Round 1", or
// "2028 R2" over "Round 2 pick"; from: the team that gave it up — another
// team's original pick says whose.
export const tradeChip = (p, from = "") => ({
  main: p.overall ? `No. ${p.overall}` : `${p.year} R${p.round}`,
  sub: `${p.overall ? `${p.year} Round ${p.round}` : `Round ${p.round} pick`}${p.original && from && p.original !== from ? ` · ${p.original}` : ""}`,
});

// A trade, as a graphic, set right before the pick it's about: a thin
// strip with the headline, then the two sides in a band — each on its own
// colors, its dark logo (LogoDark — the band is dark; Logo1 without one),
// to its team page, beside its name and the picks it
// received as one-line chips, the second side mirrored — with swap arrows
// between. sides: two [{ team, brand (fetchNflBranding's), picks:
// [tradeChip], note (in place of chips when it got none listed), label
// (after its name — "get" by default), heading (a big header in place of
// the name — the recap's RECEIVED / GAVE UP) }]. footer: a line under the band.
export function TradeCard({ title, sides, isMobile, tag = "TRADE", footer = "" }) {
  const side = ({ team, brand = {}, picks = [], note = "", label = "get", heading = "" }, flip) => {
    const c1 = brand.Color1 || BLUE;
    const c2 = brand.Color2 || GOLD;
    const ink = textOn(c1, c2);
    const name = brand.Team || NFL_TEAMS[team] || team;
    const logo = isMobile ? 30 : 40;
    return (
      <div key={flip ? "right" : "left"} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: flip ? "row-reverse" : "row", alignItems: "center", gap: isMobile ? 8 : 12,
        padding: isMobile ? (flip ? "8px 10px 8px 22px" : "8px 22px 8px 10px") : (flip ? "10px 16px 10px 30px" : "10px 30px 10px 16px"),
        background: `linear-gradient(${flip ? 250 : 110}deg, ${c1} 0%, ${c1} 60%, ${c2} 140%)`, color: ink }}>
        <Link to={`/nfl/${String(team).toLowerCase()}`} title={name} style={{ flexShrink: 0, lineHeight: 0 }}>
          {brand.LogoDark || brand.Logo1
            ? <img src={brand.LogoDark || brand.Logo1} alt={name} style={{ width: logo, height: logo, objectFit: "contain", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.25))" }} />
            : <span style={{ display: "inline-block", width: logo, height: logo }} />}
        </Link>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: flip ? "flex-end" : "flex-start", gap: 4 }}>
          {heading ? (
            <span style={{ fontFamily: FONT, fontSize: isMobile ? 16 : 22, lineHeight: 1, letterSpacing: "0.06em", whiteSpace: "nowrap", textShadow: "0 1px 3px rgba(0,0,0,0.25)" }}>{heading}</span>
          ) : (
            <span style={{ fontSize: isMobile ? 10 : 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
              {name}{picks.length ? <span style={{ opacity: 0.7 }}> {label}</span> : null}
            </span>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: flip ? "flex-end" : "flex-start", gap: 4 }}>
            {picks.map((p, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "baseline", gap: 5, background: "#fff", color: INK, borderRadius: 6,
                padding: isMobile ? "2px 6px" : "3px 8px", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", whiteSpace: "nowrap" }}>
                <span style={{ fontFamily: FONT, fontSize: isMobile ? 12 : 14 }}>{p.main}</span>
                <span style={{ fontFamily: BODY_FONT, fontSize: 10, fontWeight: 700, color: MUTED }}>{p.sub}</span>
              </span>
            ))}
            {!picks.length && note && <span style={{ fontFamily: BODY_FONT, fontSize: 11, fontWeight: 700, opacity: 0.85 }}>{note}</span>}
          </div>
        </div>
      </div>
    );
  };
  return (
    <div className="wd-mock-card" style={{ borderRadius: 14, overflow: "hidden", boxShadow: CARD_SHADOW, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: isMobile ? "5px 10px" : "6px 14px", background: INK, color: "#fff" }}>
        <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", background: GOLD, color: "#1a1005", borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{tag}</span>
        <span style={{ fontFamily: BODY_FONT, fontSize: isMobile ? 11 : 12, fontWeight: 800, minWidth: 0 }}>{title}</span>
      </div>
      <div style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
        {side(sides[0], false)}
        <span aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: isMobile ? 26 : 32, height: isMobile ? 26 : 32,
          borderRadius: "50%", background: "#fff", color: INK, display: "flex", alignItems: "center", justifyContent: "center", fontSize: isMobile ? 14 : 17, fontWeight: 900,
          boxShadow: "0 2px 6px rgba(0,0,0,0.3)" }}>⇄</span>
        {side(sides[1], true)}
      </div>
      {footer && <div style={{ padding: isMobile ? "5px 10px" : "6px 14px", fontFamily: BODY_FONT, fontSize: 11, fontWeight: 700, color: MUTED, background: "#f7f9fc" }}>{footer}</div>}
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
