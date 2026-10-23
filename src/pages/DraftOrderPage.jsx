// src/pages/DraftOrderPage.jsx
//
// /draftorder — the full projected order of the upcoming NFL drafts, all
// seven rounds, as an SEO landing page ("2027 NFL Draft Order and Projected
// Picks"). Same data as the team pages' Projected Picks tab
// (components/UpcomingPicks.jsx → draftOrders/{year}, utils/draftOrder.js):
// re-sorted from the standings every Tuesday, trades from Admin → Draft
// Order. Each team links to its team page.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import { fetchDraft, UPCOMING_DRAFTS } from "../components/UpcomingPicks";
import { fetchNflBranding } from "../utils/draftProfileData";
import { NFL_TEAMS } from "../utils/coachHistory";
import { DRAFT_ROUNDS, followsOrder, ORDER_YEAR } from "../utils/draftOrder";
import { textOn } from "../utils/teamColors";
import MarginAds from "../components/MarginAds";
import { TopProspectsRail, RecentVideosRail } from "../components/DraftSideRails";
import { viewportCssWidth } from "../utils/pageZoom";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const ROUND_WORD = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh"];
const nickname = (abbr) => (NFL_TEAMS[abbr] || abbr).split(" ").pop();

// Same layout as the team and player pages: when the window has room, a
// side column on each side of the centered page (top prospects left, recent
// videos right) and the NFL margin ads in the gutters outside both.
const COLUMN_WIDTH = 1000;
const RAIL_WIDTH = 220;
const RAIL_GAP = 16;
const SIDE = RAIL_WIDTH + RAIL_GAP;
const railsFit = () => viewportCssWidth() >= COLUMN_WIDTH + 2 * SIDE + 32;

export default function DraftOrderPage() {
  const [year, setYear] = useState(UPCOMING_DRAFTS[0].year);
  const [round, setRound] = useState(1);
  const [draft, setDraft] = useState(null);
  const [teams, setTeams] = useState({});
  const [error, setError] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [showRails, setShowRails] = useState(() => typeof window !== "undefined" && railsFit());
  const contentRef = useRef(null);

  useEffect(() => {
    const onResize = () => { setIsMobile(window.innerWidth < 768); setShowRails(railsFit()); };
    window.addEventListener("resize", onResize);
    window.addEventListener("pagezoomchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pagezoomchange", onResize);
    };
  }, []);
  const rails = showRails && !isMobile;
  useEffect(() => { fetchNflBranding().then(setTeams).catch(() => {}); }, []);
  useEffect(() => {
    let cancelled = false;
    setDraft(null);
    setError(false);
    fetchDraft(UPCOMING_DRAFTS.find((d) => d.year === year))
      .then((d) => { if (!cancelled) setDraft(d); })
      .catch((e) => { console.error("Draft order load error:", e); if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [year]);

  const title = `${year} NFL Draft Order and Projected Picks`;
  const firstRound = (draft?.picks || []).filter((p) => p.Round === 1).sort((a, b) => a.Pick - b.Pick);
  const holder = (p) => p.Traded || p.Team;
  const top = firstRound.slice(0, 3).map((p) => `${NFL_TEAMS[holder(p)] || holder(p)} (No. ${p.Pick})`);
  const description = top.length
    ? `The full ${year} NFL Draft order, all seven rounds and every traded pick. ${top.join(", ")} lead the projected order, updated every Tuesday from the standings.`
    : `The full ${year} NFL Draft order, all seven rounds and every traded pick, updated every Tuesday from the standings.`;
  const url = "https://we-draft.com/draftorder";
  const updated = draft?.updatedAt ? draft.updatedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;
  const picks = (draft?.picks || []).filter((p) => p.Round === round).sort((a, b) => a.Pick - b.Pick);
  const traded = (draft?.picks || []).filter((p) => p.Traded).length;

  const chip = (on) => ({
    border: `2px solid ${on ? BLUE : "#d8dee8"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : "#3a4352",
    borderRadius: 999, padding: isMobile ? "6px 11px" : "7px 16px", fontFamily: "inherit", fontWeight: 900, fontSize: isMobile ? 12 : 13, letterSpacing: "0.05em", cursor: "pointer",
  });

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
      </Helmet>

      {/* NFL ads, measured against the whole footprint so they sit outside the side columns. */}
      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={rails ? 0 : 24} watch={[rails]} />

      <div ref={contentRef} style={{ position: "relative", maxWidth: rails ? COLUMN_WIDTH + 2 * SIDE : COLUMN_WIDTH, margin: "0 auto", padding: rails ? `0 ${SIDE}px` : 0, boxSizing: "border-box" }}>
      {/* Full-height strips in the side columns, so each card can stay in view as the page scrolls. */}
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
      <div style={{ maxWidth: COLUMN_WIDTH, margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 24px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
        {/* ── Hero ── */}
        <div style={{
          borderRadius: 16, padding: isMobile ? "20px 16px" : "30px 32px", marginBottom: 18, overflow: "hidden",
          background: `linear-gradient(120deg, #00305c 0%, ${BLUE} 60%, #1d6fc0 100%)`, boxShadow: "0 10px 28px rgba(0,0,0,0.2)",
        }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: GOLD }}>NFL Draft</div>
          <h1 style={{ margin: "6px 0 10px", fontSize: isMobile ? 26 : 42, fontWeight: 900, color: "#fff", textTransform: "uppercase", lineHeight: 1.05, letterSpacing: "0.01em" }}>
            {title}
          </h1>
          <p style={{ margin: 0, maxWidth: 720, fontSize: isMobile ? 13 : 15, fontWeight: 600, color: "rgba(255,255,255,0.88)", lineHeight: 1.55, fontFamily: "Arial, sans-serif" }}>
            Every pick in all seven rounds, in projected order — the reverse of the standings, with every trade applied
            {followsOrder(year) ? `. The ${year} draft follows the ${ORDER_YEAR} order until its own season settles it.` : "."}
            {traded ? ` ${traded} picks have changed hands so far.` : ""}
          </p>
          {updated && (
            <div style={{ display: "inline-block", marginTop: 14, padding: "4px 12px", borderRadius: 999, background: "rgba(255,255,255,0.14)", color: "#fff", fontSize: 12, fontWeight: 900, fontFamily: "Arial, sans-serif" }}>
              ● Last updated {updated}
            </div>
          )}
        </div>

        {/* ── Year + round ── */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {UPCOMING_DRAFTS.map((d) => <button key={d.year} onClick={() => setYear(d.year)} aria-pressed={d.year === year} style={chip(d.year === year)}>{d.year} Draft</button>)}
        </div>
        <div role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
          {Array.from({ length: DRAFT_ROUNDS }, (_, i) => i + 1).map((r) => (
            <button key={r} role="tab" aria-selected={r === round} onClick={() => setRound(r)} style={{ ...chip(r === round), borderRadius: 8 }}>
              {isMobile ? `R${r}` : `Round ${r}`}
            </button>
          ))}
        </div>

        <h2 style={{ margin: "0 0 12px 2px", fontSize: isMobile ? 16 : 20, fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {year} {ROUND_WORD[round]} Round
        </h2>

        {error ? (
          <div style={{ padding: 30, textAlign: "center", color: "#b42318", fontSize: 13 }}>Couldn&apos;t load the draft order — try again.</div>
        ) : !draft ? (
          <LoadingSpinner label="Loading draft order" size={28} minHeight="240px" />
        ) : (
          // One team per row, each in its own colors: the pick number big on
          // the team's color, a faded logo bleeding off the right edge, and the
          // top of each round given extra room.
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <style>{`
              .wd-order-row { transition: transform 0.16s ease, box-shadow 0.16s ease; }
              .wd-order-row:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.16) !important; }
              @media (prefers-reduced-motion: reduce) { .wd-order-row, .wd-order-row:hover { transition: none; transform: none; } }
            `}</style>
            {picks.map((p, i) => {
              const t = holder(p);
              const brand = teams[t] || {};
              const c1 = brand.Color1 || BLUE;
              const c2 = brand.Color2 || GOLD;
              const ink = textOn(c1, c2);
              // The first five of the round stand out a little more.
              const marquee = i < 5;
              const numW = isMobile ? (marquee ? 64 : 54) : (marquee ? 96 : 78);
              const logoSize = isMobile ? (marquee ? 44 : 36) : (marquee ? 64 : 48);
              return (
                <Link
                  key={p.Pick} to={`/nfl/${t.toLowerCase()}`} title={p.Conditional || NFL_TEAMS[t]} className="wd-order-row"
                  style={{
                    position: "relative", display: "flex", alignItems: "stretch", overflow: "hidden", textDecoration: "none",
                    borderRadius: 14, background: "#fff", minHeight: isMobile ? (marquee ? 70 : 58) : (marquee ? 92 : 72),
                    boxShadow: "0 2px 6px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2",
                  }}
                >
                  {/* Pick number on the team color, a slice of the second color down its edge. */}
                  <span style={{
                    flexShrink: 0, width: numW, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    background: `linear-gradient(160deg, ${c1} 0%, ${c1} 70%, ${c2} 100%)`, color: ink, borderRight: `4px solid ${c2}`,
                  }}>
                    <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", opacity: 0.8 }}>PICK</span>
                    <span style={{ fontSize: isMobile ? (marquee ? 28 : 22) : (marquee ? 42 : 32), fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{p.Pick}</span>
                  </span>

                  <span style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: isMobile ? 10 : 16, padding: isMobile ? "8px 12px" : "10px 20px" }}>
                    {/* Faded team-color wash + the team's wordmark faded in the background. */}
                    <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, #fff 35%, ${c1}1f 100%)`, pointerEvents: "none" }} />
                    {(brand.Wordmark || brand.WordmarkDark) && (
                      <img src={brand.Wordmark || brand.WordmarkDark} alt="" aria-hidden="true" style={{
                        position: "absolute", right: isMobile ? -10 : 8, top: "50%", transform: "translateY(-50%)",
                        height: "130%", maxWidth: isMobile ? "60%" : "45%", objectFit: "contain", opacity: 0.12, pointerEvents: "none",
                      }} />
                    )}
                    {brand.Logo1
                      ? <img src={brand.Logo1} alt="" style={{ position: "relative", width: logoSize, height: logoSize, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.18))" }} />
                      : <span style={{ width: logoSize, flexShrink: 0 }} />}
                    <span style={{ position: "relative", flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 10, fontWeight: 900, color: "#7a8597", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                        {brand.City || (NFL_TEAMS[t] || t).split(" ").slice(0, -1).join(" ")}
                      </span>
                      <span style={{ display: "block", fontSize: isMobile ? (marquee ? 20 : 17) : (marquee ? 30 : 22), fontWeight: 900, color: "#1a1f2b", textTransform: "uppercase", letterSpacing: "0.01em", lineHeight: 1.05, overflowWrap: "anywhere" }}>
                        {brand.Team || nickname(t)}
                      </span>
                    </span>
                    <span style={{ position: "relative", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      {p.Traded && (
                        <span style={{ fontSize: 10, fontWeight: 900, color: "#8a5a00", background: "#fff1d6", border: "1px solid #f6c56b", borderRadius: 999, padding: "3px 9px", letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                          Via {nickname(p.Team)}
                        </span>
                      )}
                      {p.Conditional && (
                        <span style={{ fontSize: 10, fontWeight: 800, color: "#5f6b7a", fontStyle: "italic", whiteSpace: "nowrap" }}>Conditional</span>
                      )}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        <p style={{ margin: "18px 4px 0", fontSize: 12, fontWeight: 700, color: "#5f6b7a", lineHeight: 1.6, fontFamily: "Arial, sans-serif" }}>
          How the order works: non-playoff teams pick 1–20, worst record first; playoff teams follow by the round they were eliminated,
          with the Super Bowl champion last. Ties go to the team with the easier strength of schedule. Compensatory picks aren&apos;t included yet.
        </p>
      </div>
      </div>
    </>
  );
}
