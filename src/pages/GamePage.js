// src/pages/GamePage.js
//
// Public page for a single game, authored from the Admin Panel's CFB
// Schedule editor (see AdminPanel.js's CFBScheduleSection). Renders one of
// two states off the same schedule26 doc: pregame (matchup + key players +
// preview notes) and final (score + review notes + each team's top
// performances — key players step aside once there's real performance data
// to show instead). Left/right position is the only "AWAY"/"HOME" label
// anywhere on the page — each side's own logo identifies the school, so
// nothing here restates a full name a second time next to it or spells out
// which side is which.
import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import LoadingSpinner from "../components/LoadingSpinner";
import GameMarginSidebars from "../components/GameMarginSidebars";

// Same flair badge assets/config as PlayerProfile.js's hero (duplicated
// rather than imported cross-page, matching this codebase's own convention
// for small shared constants — see MarginSidebars.js's file header) — Key
// Players rows show a player's own flair badge here instead of a plain
// rank number, the same badge that'd show on their profile page.
import EliteFlair from "../assets/elite.png";
import StarFlair from "../assets/star.png";
import DiamondFlair from "../assets/dir.png";
import RadarFlair from "../assets/radar.png";
import SecondFlair from "../assets/second.png";
import AlienFlair from "../assets/alien.png";
import FutureStarFlair from "../assets/futurestar.png";
import CurveFlair from "../assets/curve.png";
import EarlyImpactFlair from "../assets/early impact.png";
import EarlyContributorFlair from "../assets/early contributor.png";
import Year2ContributorFlair from "../assets/y2contributor.png";
import DevelopmentalFlair from "../assets/developmental.png";
import ProvenFlair from "../assets/proven.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
// Fallback tint for a side whose school doc has no Color1 on file.
const NEUTRAL_TEAM_COLOR = "#243447";

const FLAIR_CONFIG = {
  "Elite":                { img: EliteFlair,            stroke: "#ff0000" },
  "Star":                 { img: StarFlair,             stroke: "#ebac02" },
  "Diamond in the Rough":  { img: DiamondFlair,          stroke: "#00d2ff" },
  "Under the Radar":      { img: RadarFlair,            stroke: "#79f146" },
  "Future Star":          { img: FutureStarFlair,       stroke: "#0055a5" },
  "Alien":                { img: AlienFlair,            stroke: "#5c04c9" },
  "Second Chance":        { img: SecondFlair,           stroke: "#ff6600" },
  "Ahead of the Curve":   { img: CurveFlair,            stroke: "#008aff" },
  "Early Impact":         { img: EarlyImpactFlair,      stroke: "#009295" },
  "Early Contributor":    { img: EarlyContributorFlair, stroke: "#ff00f0" },
  "Year 2 Contributor":   { img: Year2ContributorFlair, stroke: "#3b6b03" },
  "Developmental":        { img: DevelopmentalFlair,    stroke: "#fff600" },
  "Proven":               { img: ProvenFlair,           stroke: "#00124b" },
};

const GRADE_PRIORITY = { Dominant: 0, Great: 1, Good: 2, Productive: 3, Average: 4, Bad: 5 };
const gradePriority = (grade) => (grade in GRADE_PRIORITY ? GRADE_PRIORITY[grade] : 6);

// Same tiered "pop" effect as PerformancePage.js's sidebar rows — Dominant
// really pops, Great a little less, Good just a hint, Productive/Average/
// Bad get nothing.
const gradeGlowClass = (grade) => {
  if (grade === "Dominant") return "wd-perf-glow-dominant";
  if (grade === "Great") return "wd-perf-glow-great";
  if (grade === "Good") return "wd-perf-glow-good";
  return "";
};

const GRADE_GLOW_STYLE = `
  @keyframes wdPerfGlowDominant {
    0%, 100% { box-shadow: 0 0 0 1px rgba(246,162,29,0.45), 0 0 10px 3px rgba(246,162,29,0.55); }
    50%      { box-shadow: 0 0 0 1px rgba(246,162,29,0.7), 0 0 20px 7px rgba(246,162,29,0.9); }
  }
  .wd-perf-glow-dominant { animation: wdPerfGlowDominant 1.6s ease-in-out infinite; border-radius: 8px; margin: 3px 4px; }
  @keyframes wdPerfGlowGreat {
    0%, 100% { box-shadow: 0 0 0 1px rgba(246,162,29,0.2), 0 0 5px 1px rgba(246,162,29,0.22); }
    50%      { box-shadow: 0 0 0 1px rgba(246,162,29,0.32), 0 0 9px 2px rgba(246,162,29,0.38); }
  }
  .wd-perf-glow-great { animation: wdPerfGlowGreat 2.6s ease-in-out infinite; border-radius: 8px; margin: 3px 4px; }
  .wd-perf-glow-good { box-shadow: 0 0 0 1px rgba(246,162,29,0.18); border-radius: 8px; margin: 3px 4px; }
  .wd-perf-row-link { transition: background 0.15s ease, padding-left 0.15s ease; }
  .wd-perf-row-link:hover { background: #eaf1ff; padding-left: 20px; }
  .wd-perf-row-chevron { opacity: 0; transform: translateX(-6px); transition: opacity 0.15s ease, transform 0.15s ease; }
  .wd-perf-row-link:hover .wd-perf-row-chevron { opacity: 1; transform: translateX(0); }
  @keyframes wdFeaturedShimmer {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
  }
  .wd-featured-ribbon { animation: wdFeaturedShimmer 3.5s linear infinite; }

  /* Game of the Week — a separate, more intense tier than Featured: a
     fire-toned shimmer on the ribbon, plus a slow pulsing glow around the
     whole card (rgba(255,69,0,...) matches the ribbon's orange). Both
     slowed down and toned down from an earlier pass that felt too frantic. */
  @keyframes wdGotwShimmer {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
  }
  .wd-gotw-ribbon { animation: wdGotwShimmer 4s linear infinite; }
  @keyframes wdGotwCardGlow {
    0%, 100% { box-shadow: 0 10px 30px rgba(0,0,0,0.12), 0 0 0px rgba(255,69,0,0); }
    50%      { box-shadow: 0 10px 32px rgba(0,0,0,0.14), 0 0 20px rgba(255,69,0,0.35); }
  }
  .wd-gotw-card-glow { animation: wdGotwCardGlow 3.6s ease-in-out infinite; }

  /* Hero background "energy" — a slowly drifting yard-line texture and a
     breathing spotlight, so the banner isn't a static image. */
  @keyframes wdFieldDrift {
    0%   { transform: translate(0, 0); }
    100% { transform: translate(-80px, -46px); }
  }
  @keyframes wdSpotlightPulse {
    0%, 100% { opacity: 0.7; }
    50%      { opacity: 1; }
  }

  /* Key Player hover note — collapsed by default, expands under the row's
     name when that row is hovered (see AdminPanel.js's per-player note
     field in the CFB Schedule editor). */
  .wd-keyplayer-note-wrap { max-height: 0; opacity: 0; overflow: hidden; margin-top: 0; transition: max-height 0.25s ease, opacity 0.2s ease, margin-top 0.25s ease; }
  .wd-perf-row-link:hover .wd-keyplayer-note-wrap { max-height: 80px; opacity: 1; margin-top: 6px; }
`;

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

// Imgur happily serves raw image bytes from imgur.com itself (which is why
// a plain <img> works), but caps that host's CORS header to imgur.com — the
// canvas read useTrimmedImage needs below requires the i.imgur.com CDN
// subdomain's more permissive header instead. Same fix AdminPanel.js's
// clipboard-copy feature uses for the same underlying reason.
function corsFriendlyImageUrl(url) {
  return url.replace(/^(https?:\/\/)imgur\.com\//i, "$1i.imgur.com/");
}

// Every school's Wordmark is exported at the same canvas size, but the
// actual logotype fills wildly different fractions of that canvas from one
// school to the next — displayed at a shared height with no further work,
// a tightly-cropped wordmark reads much bigger than one sitting in a sea of
// transparent padding. This auto-crops each wordmark down to just its
// non-transparent pixels (via an offscreen canvas scan) so a shared display
// height actually means a shared *visual* size. Shows the untouched
// original immediately, then swaps in the trimmed version once the crop
// finishes (or leaves the original in place if the canvas read fails, e.g.
// a non-CORS-friendly host).
function useTrimmedImage(url) {
  const [src, setSrc] = useState(url || null);

  useEffect(() => {
    if (!url) { setSrc(null); return; }
    setSrc(url);
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, w, h);
        const ALPHA_THRESHOLD = 12;
        let top = h, bottom = -1, left = w, right = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
              if (y < top) top = y;
              if (y > bottom) bottom = y;
              if (x < left) left = x;
              if (x > right) right = x;
            }
          }
        }
        if (right < left || bottom < top) return; // fully transparent — keep original
        const cropW = right - left + 1, cropH = bottom - top + 1;
        if (cropW === w && cropH === h) return; // already tight — nothing to gain
        const out = document.createElement("canvas");
        out.width = cropW;
        out.height = cropH;
        out.getContext("2d").drawImage(canvas, left, top, cropW, cropH, 0, 0, cropW, cropH);
        if (!cancelled) setSrc(out.toDataURL("image/png"));
      } catch (e) { /* CORS-tainted canvas or decode failure — keep the untrimmed original */ }
    };
    img.src = corsFriendlyImageUrl(url);
    return () => { cancelled = true; };
  }, [url]);

  return src;
}

const timeToMinutes = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
};
const formatTime12h = (t) => {
  const mins = timeToMinutes(t);
  if (mins == null) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
};

// One side of the hero matchup — just a big logo and that school's wordmark
// as a huge, faint backdrop behind it (no separate AWAY/HOME tag — which
// side is which is already implied by left/right position, matching the
// Away/Home columns below). No room needed for ad rails on this page, just
// the margin sidebars, so the hero can spend the extra width on scale
// instead. Logo preference for this page: LogoDark (reads better against
// the hero's colored background than a school's normal logo) else the plain
// primary logo — LogoBlack is a separate asset meant for the Performances
// terminal's near-black background, not a colored one like this hero's, so
// it isn't part of this chain.
//
// Backdrop wordmark: WordmarkDark if the school has one, else the plain
// Wordmark used the same way (a low-opacity backdrop doesn't need the
// contrast guarantee a foreground element would — 30% opacity over the
// team's own color reads fine either way). Sized as wide as the column will
// take (112%/135% of it — the column's own width is well-defined since it's
// a flex item with an explicit width:0 basis, so percentage widths on an
// absolutely-positioned child resolve correctly), while its *vertical*
// anchor is a plain pixel offset computed from logoSize instead of a
// percentage/calc — this column's rendered height is undefined for
// percentage-resolution purposes (flex auto-height), but a literal px value
// doesn't need that resolution step at all. Together that's "as big as
// fits the width" with its own vertical center landing about a third of
// the way up the logo (logoSize * 2/3 down from the logo's own top) —
// centering rather than anchoring by its top edge, since schools' wordmarks
// render at very different heights for the same width, and centering keeps
// that difference from pushing some schools' text further off the bottom
// of the hero than others.
function TeamHeroSide({ school, schoolData, isMobile, dimmed }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const [wordmarkFailed, setWordmarkFailed] = useState(false);
  const [wordmarkDarkFailed, setWordmarkDarkFailed] = useState(false);
  const wordmarkSrc = useTrimmedImage(schoolData?.Wordmark ? sanitizeUrl(schoolData.Wordmark) : null);
  const wordmarkDarkSrc = useTrimmedImage(schoolData?.WordmarkDark ? sanitizeUrl(schoolData.WordmarkDark) : null);

  const logoSrc = schoolData?.LogoDark || schoolData?.Logo1 || "";
  const accent = schoolData?.Color1 || NEUTRAL_TEAM_COLOR;
  const logoSize = isMobile ? 112 : 250;
  const backdropTop = Math.round((logoSize * 2) / 3);

  const showWordmarkDark = !!wordmarkDarkSrc && !wordmarkDarkFailed;
  const showWordmarkFallback = !showWordmarkDark && !!wordmarkSrc && !wordmarkFailed;
  const backdropSrc = showWordmarkDark ? wordmarkDarkSrc : (showWordmarkFallback ? wordmarkSrc : null);

  const style = {
    position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
    textDecoration: "none", flex: "1 1 0", minWidth: 0, width: 0,
    opacity: dimmed ? 0.55 : 1, transition: "opacity 0.3s ease",
  };

  const inner = (
    <>
      {backdropSrc && (
        <img
          src={backdropSrc} alt="" aria-hidden="true"
          onError={() => (showWordmarkDark ? setWordmarkDarkFailed(true) : setWordmarkFailed(true))}
          style={{
            // Anchored by its own vertical CENTER landing at backdropTop,
            // not its top edge — wordmarks render at wildly different
            // heights for the same width depending on their own aspect
            // ratio, so anchoring by top edge let a taller one hang
            // further down than a shorter one (uneven side to side) and
            // sometimes run off the bottom of the hero. Centering splits
            // that extra height evenly above/below the same target point
            // for every school instead of dumping it all downward.
            position: "absolute", top: `${backdropTop}px`, left: "50%", transform: "translate(-50%, -50%)",
            width: isMobile ? "135%" : "112%", height: "auto",
            opacity: 0.3, objectFit: "contain", pointerEvents: "none", zIndex: 0,
          }}
        />
      )}

      {logoSrc && !logoFailed ? (
        <img
          src={sanitizeUrl(logoSrc)} alt={school}
          style={{
            position: "relative", zIndex: 1,
            height: `${logoSize}px`, width: `${logoSize}px`, objectFit: "contain",
            filter: "drop-shadow(0 10px 22px rgba(0,0,0,0.55))",
          }}
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <div style={{
          position: "relative", zIndex: 1,
          height: `${logoSize}px`, width: `${logoSize}px`, borderRadius: "50%",
          background: accent, display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: isMobile ? "36px" : "68px", fontWeight: 900,
        }}>
          {(school || "?").charAt(0)}
        </div>
      )}
    </>
  );

  return schoolData?.Slug ? (
    <Link to={`/team/${schoolData.Slug}`} style={style}>{inner}</Link>
  ) : (
    <div style={style}>{inner}</div>
  );
}

// One team's content column — Key Players pregame, Top Performances once
// Final (never both; Key Players steps aside for real performance data the
// moment there's some to show). The whole column is one card headed by a
// strip in that team's own Color1/Color2 (the same colors as its half of
// the hero above, and the same AWAY/HOME pill styling) so this reads as a
// continuation of the matchup rather than a plain white list bolted on
// underneath it — previously just a small gray "AWAY"/"HOME" label sat
// above a differently-colored (site BLUE) box, which is exactly the kind of
// "doesn't feel like part of the game" seam this closes.
function TeamColumn({ tag, schoolData, keyPlayers, performances, mode, keyPlayerNotes }) {
  const accent1 = schoolData?.Color1 || BLUE;
  const accent2 = schoolData?.Color2 || GOLD;
  const isFinalMode = mode === "final";
  const items = isFinalMode ? performances : keyPlayers;

  return (
    <div style={{ border: `2px solid ${accent1}`, borderRadius: "12px", overflow: "hidden", background: "#fff", boxShadow: "0 6px 18px rgba(0,0,0,0.1)" }}>
      {/* Just the mini logo — no "AWAY"/"HOME" label needed, this column
          already sits under the matching side of the hero above it. */}
      <div style={{ background: accent1, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {schoolData?.Logo1 ? (
          <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
            <img
              src={sanitizeUrl(schoolData.Logo1)} alt={tag}
              style={{ width: "78%", height: "78%", objectFit: "contain" }}
              onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }}
            />
          </div>
        ) : (
          <span style={{ color: "#fff", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.14em" }}>{tag}</span>
        )}
      </div>
      <div style={{ height: "3px", background: accent2 }} />

      {items.length === 0 ? (
        <div style={{ color: "#bbb", fontSize: "13px", fontStyle: "italic", padding: "16px" }}>
          {isFinalMode ? "No performances written up yet." : "None selected yet."}
        </div>
      ) : isFinalMode ? (
        // Just the player and their stat line — the title/grade text lives
        // on the performance's own page; the grade still shows up here as
        // the row's glow (see gradeGlowClass), not as text.
        performances.map((perf, i) => (
          <Link
            key={perf.id}
            to={`/performance/${perf.slug}`}
            className={`wd-perf-row-link ${gradeGlowClass(perf.grade)}`}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "12px 16px", textDecoration: "none",
              borderBottom: i < performances.length - 1 ? "1px solid #f0f0f0" : "none",
              borderLeft: `4px solid ${accent1}`,
              background: `linear-gradient(90deg, ${accent1}0d, transparent 40%)`,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#222", fontWeight: 900, fontSize: "16px", lineHeight: 1.3 }}>
                {perf.playerName || perf.titleShort}
              </div>
              {perf.statLine && (
                <div style={{ color: "#555", fontWeight: 700, fontSize: "12px", fontFamily: "'Courier New', monospace", letterSpacing: "0.02em", marginTop: "3px" }}>
                  {perf.statLine}
                </div>
              )}
            </div>
            <span className="wd-perf-row-chevron" style={{ color: accent1, fontSize: "18px", fontWeight: 900, flexShrink: 0 }}>›</span>
          </Link>
        ))
      ) : (
        keyPlayers.map((p, i) => {
          // A player's own flair badge (same asset/config as their profile
          // page's hero) stands in for a plain rank number when they have
          // one — falls back to the number for players without a flair set.
          const flairInfo = p.Flair ? FLAIR_CONFIG[String(p.Flair).trim()] : null;
          const note = keyPlayerNotes?.[p.id];
          return (
            <Link
              key={p.id}
              to={`/player/${p.Slug}`}
              className="wd-perf-row-link"
              style={{
                display: "flex", alignItems: "center", gap: "16px", padding: "16px 18px", textDecoration: "none",
                borderBottom: i < keyPlayers.length - 1 ? "1px solid #f0f0f0" : "none",
                borderLeft: `4px solid ${accent1}`,
                background: `linear-gradient(90deg, ${accent1}0d, transparent 40%)`,
              }}
            >
              {flairInfo ? (
                <div style={{
                  flexShrink: 0, width: "46px", height: "46px", borderRadius: "10px",
                  background: "#fff", border: `2px solid ${flairInfo.stroke}`,
                  boxShadow: `0 0 12px ${flairInfo.stroke}66`,
                  display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                }} title={p.Flair}>
                  <img src={flairInfo.img} alt={p.Flair} style={{ height: "80%", width: "80%", objectFit: "contain" }} />
                </div>
              ) : (
                <div style={{
                  flexShrink: 0, width: "42px", height: "42px", borderRadius: "50%",
                  background: accent1, border: `2px solid ${accent2}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontWeight: 900, fontSize: "17px",
                }}>
                  {i + 1}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: BLUE, fontWeight: 900, fontSize: "19px", lineHeight: 1.2 }}>{p.First} {p.Last}</div>
                {/* Admin-written note (AdminPanel.js's CFB Schedule editor) —
                    collapsed until this row is hovered (see .wd-keyplayer-note-wrap
                    in GRADE_GLOW_STYLE), so the list stays compact by default. */}
                {note && (
                  <div className="wd-keyplayer-note-wrap">
                    <div style={{ color: "#666", fontWeight: 600, fontSize: "12.5px", lineHeight: 1.4, fontStyle: "italic" }}>
                      {note}
                    </div>
                  </div>
                )}
              </div>
              <span style={{
                background: accent1, color: "#fff", fontWeight: 900, fontSize: "12px",
                padding: "6px 13px", borderRadius: "6px", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0,
              }}>
                {p.Position || "—"}
              </span>
              <span className="wd-perf-row-chevron" style={{ color: accent1, fontSize: "20px", fontWeight: 900, flexShrink: 0 }}>›</span>
            </Link>
          );
        })
      )}
    </div>
  );
}

export default function GamePage() {
  const { slug } = useParams();
  const [game, setGame] = useState(null);
  const [awaySchool, setAwaySchool] = useState(null);
  const [homeSchool, setHomeSchool] = useState(null);
  const [keyPlayersAway, setKeyPlayersAway] = useState([]);
  const [keyPlayersHome, setKeyPlayersHome] = useState([]);
  const [performancesAway, setPerformancesAway] = useState([]);
  const [performancesHome, setPerformancesHome] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  const contentRef = useRef(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    setGame(null);
    setAwaySchool(null);
    setHomeSchool(null);
    setKeyPlayersAway([]);
    setKeyPlayersHome([]);
    setPerformancesAway([]);
    setPerformancesHome([]);
    setNotFound(false);
    setLoading(true);

    const fetch = async () => {
      try {
        const snap = await getDocs(query(collection(db, "schedule26"), where("Slug", "==", slug)));
        if (snap.empty) {
          setNotFound(true);
          return;
        }
        const g = { id: snap.docs[0].id, ...snap.docs[0].data() };
        setGame(g);

        const isFinal = g.Final && g.HomeScore != null && g.AwayScore != null;
        const keyAwayIds = isFinal ? [] : (g.KeyPlayersAway || []);
        const keyHomeIds = isFinal ? [] : (g.KeyPlayersHome || []);

        const [awaySchoolSnap, homeSchoolSnap, keyAwaySnaps, keyHomeSnaps, perfSnap] = await Promise.all([
          g.Away ? getDocs(query(collection(db, "schools"), where("School", "==", g.Away))) : null,
          g.Home ? getDocs(query(collection(db, "schools"), where("School", "==", g.Home))) : null,
          Promise.all(keyAwayIds.map((id) => getDoc(doc(db, "players", id)))),
          Promise.all(keyHomeIds.map((id) => getDoc(doc(db, "players", id)))),
          isFinal ? getDocs(query(collection(db, "performances"), where("gameId", "==", g.id), where("status", "==", "published"))) : null,
        ]);

        if (awaySchoolSnap && !awaySchoolSnap.empty) setAwaySchool({ id: awaySchoolSnap.docs[0].id, ...awaySchoolSnap.docs[0].data() });
        if (homeSchoolSnap && !homeSchoolSnap.empty) setHomeSchool({ id: homeSchoolSnap.docs[0].id, ...homeSchoolSnap.docs[0].data() });
        setKeyPlayersAway(keyAwaySnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() })));
        setKeyPlayersHome(keyHomeSnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() })));

        if (perfSnap) {
          const all = perfSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const sortByGrade = (a, b) => gradePriority(a.grade) - gradePriority(b.grade);
          setPerformancesAway(all.filter((p) => p.school === g.Away).sort(sortByGrade).slice(0, 5));
          setPerformancesHome(all.filter((p) => p.school === g.Home).sort(sortByGrade).slice(0, 5));
        }
      } catch (e) {
        console.error("Game page load error:", e);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [slug]);

  if (loading) return <LoadingSpinner label="Loading" size={56} minHeight="60vh" />;

  if (notFound || !game) {
    return (
      <div style={{ textAlign: "center", marginTop: "80px", color: "#999", fontStyle: "italic", fontSize: "16px" }}>
        Game not found.
      </div>
    );
  }

  const isFinal = game.Final && game.HomeScore != null && game.AwayScore != null;
  const gameDateMs = game.Date?.toDate ? game.Date.toDate().getTime() : (game.Date ? new Date(game.Date).getTime() : 0);
  // Date-only field is stored as UTC midnight — format in UTC too, or a
  // viewer west of it sees the game roll back a calendar day.
  const dateStr = gameDateMs ? new Date(gameDateMs).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
  const timeStr = formatTime12h(game.Time);
  const awayWon = isFinal && game.AwayScore > game.HomeScore;
  const homeWon = isFinal && game.HomeScore > game.AwayScore;
  const awayColor = awaySchool?.Color1 || NEUTRAL_TEAM_COLOR;
  const homeColor = homeSchool?.Color1 || NEUTRAL_TEAM_COLOR;
  // Pregame, an empty Key Players section entirely is just unfilled admin
  // scaffolding, not meaningful context worth showing — unlike a Final game
  // with no performances written up yet, which still stays visible as real
  // information. But once at least one side has a pick, both columns show
  // side by side as usual — the empty one just falls back to its own
  // "None selected yet." message rather than disappearing and leaving a
  // lopsided single-column layout.
  const showKeyPlayersSection = isFinal || keyPlayersAway.length > 0 || keyPlayersHome.length > 0;
  // "Back" always means this game's week slate — the CFB schedule for that
  // week (every game, not just the ones with performances) — not the
  // Performances hub. Only falls back to the CFB schedule's own default
  // (current week) if this game somehow has no Week on file.
  const weekSlateUrl = game.Week ? `/cfb/schedule/${encodeURIComponent(game.Week)}` : "/cfb/schedule";
  const weekSlateLabel = game.Week ? `← ${game.Week} Slate` : "← Full Schedule";

  const canonicalUrl = `https://we-draft.com/game/${game.Slug}`;
  const seoTitle = isFinal
    ? `Final: ${game.Away} ${game.AwayScore}, ${game.Home} ${game.HomeScore} | We-Draft`
    : `${game.Away} at ${game.Home} — ${game.Week || "Preview"} | We-Draft`;
  const seoDescription = (game.Notes || "").replace(/\s+/g, " ").trim().slice(0, 160)
    || (isFinal
      ? `${game.Away} ${game.AwayScore}, ${game.Home} ${game.HomeScore} — final score, top prospect performances, and more on We-Draft.com.`
      : `${game.Away} at ${game.Home} preview — key draft prospects to watch on We-Draft.com.`);

  return (
    <>
      <style>{GRADE_GLOW_STYLE}</style>
      <Helmet>
        <title>{seoTitle}</title>
        <meta name="description" content={seoDescription} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={seoTitle} />
        <meta property="og:description" content={seoDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="We-Draft" />
      </Helmet>

      {/* This page only needs to leave room for the margin sidebars
          (GameMarginSidebars.js), not the wider gutter an ad rail would
          need, so the main content can run wider than the standard
          1000px reading column and give the hero more room to be big. */}
      <div ref={contentRef} style={{ maxWidth: "1150px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        <div className={game.GameOfWeek ? "wd-gotw-card-glow" : ""} style={{ border: `2px solid ${BLUE}`, borderRadius: "14px", overflow: "hidden", boxShadow: game.GameOfWeek ? undefined : "0 10px 30px rgba(0,0,0,0.12)" }}>

          {/* Masthead — folded into the card itself (instead of a plain
              title line sitting above it) so it reads as the top of the
              same graphic as the hero below it, rather than a separate,
              disconnected element. No "GAME" label needed — the whole page
              is obviously a game page. Date/time live here now rather than
              in the hero's own status strip, so they're not lost among the
              team colors and stay put regardless of matchup colors. */}
          <div style={{ background: BLUE, padding: isMobile ? "11px 14px" : "14px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
            {dateStr && (
              <div>
                <div style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? "16px" : "21px" }}>{dateStr}</div>
                {timeStr && (
                  <div style={{ color: GOLD, fontWeight: 800, fontSize: isMobile ? "13px" : "16px", marginTop: "2px" }}>{timeStr}</div>
                )}
              </div>
            )}
            <Link
              to={weekSlateUrl}
              style={{
                color: "#fff", background: "rgba(255,255,255,0.14)", border: `2px solid ${GOLD}`,
                borderRadius: "8px", padding: isMobile ? "7px 14px" : "9px 22px",
                fontWeight: 900, fontSize: isMobile ? "13px" : "15px", textDecoration: "none",
                textTransform: "uppercase", letterSpacing: "0.04em", marginLeft: "auto",
              }}
            >
              {weekSlateLabel}
            </Link>
          </div>
          <div style={{ height: "3px", background: GOLD }} />

          {/* Featured / Game of the Week ribbon — a proud, branded banner
              rather than a small pill buried in the status strip. Game of
              the Week is a separate, higher tier (see AdminPanel.js) and
              gets a more intense fire-toned, faster-shimmering version
              instead of Featured's gold one when both are set — showing
              both would be redundant noise on the same card. */}
          {game.GameOfWeek ? (
            <div
              className="wd-gotw-ribbon"
              style={{
                background: "linear-gradient(90deg, #ff4500, #ffb347, #ff4500, #ffb347, #ff4500)",
                backgroundSize: "200% 100%",
                padding: isMobile ? "10px 14px" : "13px 20px",
                textAlign: "center",
              }}
            >
              <span style={{ color: "#3a0f00", fontWeight: 900, fontSize: isMobile ? "13px" : "16px", textTransform: "uppercase", letterSpacing: "0.16em", textShadow: "0 1px 2px rgba(255,255,255,0.35)" }}>
                🔥 Game of the Week 🔥
              </span>
            </div>
          ) : game.Featured && (
            <div
              className="wd-featured-ribbon"
              style={{
                background: `linear-gradient(90deg, ${GOLD}, #ffe08a, ${GOLD}, #ffe08a, ${GOLD})`,
                backgroundSize: "200% 100%",
                padding: isMobile ? "8px 12px" : "10px 16px",
                textAlign: "center",
              }}
            >
              <span style={{ color: "#3a2900", fontWeight: 900, fontSize: isMobile ? "11px" : "13px", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                🏈 We-Draft.com's Featured Game
              </span>
            </div>
          )}

          {/* Hero — status strip + big branded matchup, built to fill space
              the way a Madden matchup splash screen does rather than sit as
              a modest banner: bigger logos/wordmarks, more padding, and a
              couple of animated overlay layers (a slowly drifting "yard
              line" texture + a breathing spotlight — see wdFieldDrift/
              wdSpotlightPulse below) so the background has some life to it
              instead of sitting static. The two team colors blend across a
              wide middle band (32%–68%) rather than meeting at a narrow
              seam — a hard vertical line down the middle is exactly what
              read as "the page split in half" instead of one banner (the
              dark overlay keeps white text/logos legible no matter how
              light either team's color happens to be). */}
          <div style={{
            position: "relative", overflow: "hidden",
            background: [
              "linear-gradient(rgba(0,0,0,0.42), rgba(0,0,0,0.42))",
              `linear-gradient(90deg, ${awayColor} 0%, ${awayColor} 32%, ${homeColor} 68%, ${homeColor} 100%)`,
            ].join(", "),
            padding: isMobile ? "22px 16px 34px" : "40px 40px 60px",
          }}>
            {/* Overlay layers are separate absolutely-positioned divs
                (rather than more entries in the background above) so each
                can carry its own animation — CSS can't independently
                animate one layer's position within a single composited
                multi-layer background. Both zIndex:0, sitting behind the
                zIndex:1 content below. */}
            <div aria-hidden="true" style={{
              position: "absolute", inset: "-20%", zIndex: 0, pointerEvents: "none",
              background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 2px, transparent 2px, transparent 40px)",
              animation: "wdFieldDrift 16s linear infinite",
            }} />
            <div aria-hidden="true" style={{
              position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
              background: "radial-gradient(circle at 50% 28%, rgba(255,255,255,0.16), transparent 55%)",
              animation: "wdSpotlightPulse 4s ease-in-out infinite",
            }} />

            <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: isMobile ? "10px" : "14px", flexWrap: "wrap", marginBottom: isMobile ? "22px" : "40px" }}>
              <span style={{
                background: isFinal ? "#1a7f37" : "#7c3aed", color: "#fff",
                fontSize: isMobile ? "11px" : "13px", fontWeight: 900,
                padding: isMobile ? "4px 12px" : "6px 16px", borderRadius: "6px",
                textTransform: "uppercase", letterSpacing: "0.1em",
                boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
              }}>
                {isFinal ? "🏁 Final" : "🔮 Preview"}
              </span>
              {game.Week && (
                <span style={{ color: "#fff", fontSize: isMobile ? "13px" : "17px", fontWeight: 900, textShadow: "0 2px 5px rgba(0,0,0,0.4)" }}>{game.Week}</span>
              )}
            </div>

            <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", gap: isMobile ? "12px" : "36px" }}>
              <TeamHeroSide key={`${game.id}-away`} school={game.Away} schoolData={awaySchool} isMobile={isMobile} dimmed={isFinal && homeWon} />

              <div style={{ textAlign: "center", flexShrink: 0, paddingTop: isMobile ? "26px" : "58px" }}>
                {isFinal ? (
                  <div style={{
                    display: "flex", alignItems: "center", gap: isMobile ? "8px" : "14px",
                    background: "rgba(0,0,0,0.32)", border: "2px solid rgba(255,255,255,0.25)",
                    borderRadius: "14px", padding: isMobile ? "8px 14px" : "14px 26px",
                    boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
                  }}>
                    <span style={{ fontSize: isMobile ? "28px" : "52px", fontWeight: 900, color: awayWon ? "#fff" : "rgba(255,255,255,0.45)", lineHeight: 1 }}>{game.AwayScore}</span>
                    <span style={{ fontSize: isMobile ? "14px" : "20px", fontWeight: 900, color: "rgba(255,255,255,0.3)" }}>–</span>
                    <span style={{ fontSize: isMobile ? "28px" : "52px", fontWeight: 900, color: homeWon ? "#fff" : "rgba(255,255,255,0.45)", lineHeight: 1 }}>{game.HomeScore}</span>
                  </div>
                ) : (
                  <div style={{
                    width: isMobile ? "48px" : "88px", height: isMobile ? "48px" : "88px", borderRadius: "50%",
                    background: "rgba(0,0,0,0.32)", border: `3px solid ${GOLD}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 8px 22px rgba(0,0,0,0.4)",
                  }}>
                    <span style={{ fontSize: isMobile ? "13px" : "22px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {game.Neutral ? "vs" : "at"}
                    </span>
                  </div>
                )}
                {game.Neutral && (
                  <div style={{ fontSize: "9px", fontWeight: 900, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "8px" }}>Neutral Site</div>
                )}
              </div>

              <TeamHeroSide key={`${game.id}-home`} school={game.Home} schoolData={homeSchool} isMobile={isMobile} dimmed={isFinal && awayWon} />
            </div>
          </div>
          <div style={{ height: "3px", background: GOLD }} />

          {/* Body */}
          <div style={{ background: "#fff", padding: isMobile ? "20px 16px" : "32px 32px" }}>

            {/* Notes — relabeled Preview/Recap depending on game state, styled
                as a pulled-quote card (colored spine + icon) rather than a
                flat gray box. */}
            {game.Notes && (
              <div style={{ marginBottom: "28px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "17px" }}>{isFinal ? "📰" : "🔮"}</span>
                  <span style={{ fontSize: "13px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    {isFinal ? "The Recap" : "The Preview"}
                  </span>
                </div>
                <div style={{
                  fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 700,
                  fontSize: isMobile ? "14.5px" : "16.5px", letterSpacing: "0.01em",
                  lineHeight: 1.6, color: "#161616", whiteSpace: "pre-wrap", wordWrap: "break-word",
                  background: "#fff", borderLeft: `4px solid ${GOLD}`, borderRadius: "4px 10px 10px 4px",
                  padding: isMobile ? "16px 18px" : "20px 26px",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.07)",
                }}>
                  {game.Notes}
                </div>
              </div>
            )}

            {/* Key Players (pregame) or Top Performances (final) — never both,
                and pregame the whole section steps aside if nobody's been
                picked for either side yet (see showKeyPlayersSection above). */}
            {showKeyPlayersSection && (
              <>
                <div style={{ marginBottom: "10px" }}>
                  <div style={{ fontSize: "16px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, marginBottom: "5px" }}>
                    {isFinal ? "Top Performances" : "Key Players"}
                  </div>
                  <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
                  <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? "24px" : "32px" }}>
                  <TeamColumn
                    tag="Away"
                    schoolData={awaySchool}
                    keyPlayers={keyPlayersAway}
                    performances={performancesAway}
                    mode={isFinal ? "final" : "pregame"}
                    keyPlayerNotes={game.KeyPlayerNotes}
                  />
                  <TeamColumn
                    tag="Home"
                    schoolData={homeSchool}
                    keyPlayers={keyPlayersHome}
                    performances={performancesHome}
                    mode={isFinal ? "final" : "pregame"}
                    keyPlayerNotes={game.KeyPlayerNotes}
                  />
                </div>
              </>
            )}

            {/* Footer */}
            <div style={{ marginTop: "32px", paddingTop: "16px", borderTop: "2px solid #eee", display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: "10px" }}>
              <Link to={weekSlateUrl} style={{ background: BLUE, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "6px", padding: "7px 18px", fontWeight: 900, fontSize: "12px", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {weekSlateLabel}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <GameMarginSidebars contentRef={contentRef} isMobile={isMobile} horizontalPadding={20} excludeGameId={game.id} />
    </>
  );
}
