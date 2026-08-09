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
import { collection, query, where, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import LoadingSpinner from "../components/LoadingSpinner";
import GameMarginSidebars from "../components/GameMarginSidebars";
import { useAuth } from "../context/AuthContext";
import verifiedBadge from "../assets/verified.png";
import confetti from "canvas-confetti";

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
  .wd-perf-row-link:hover { background: rgba(255,255,255,0.14); padding-left: 20px; }
  .wd-perf-row-chevron { opacity: 0; transform: translateX(-6px); transition: opacity 0.15s ease, transform 0.15s ease; }
  .wd-perf-row-link:hover .wd-perf-row-chevron { opacity: 1; transform: translateX(0); }
  /* Game of the Week / Featured badge — lives inside the hero itself now
     (see GamePage.js's render), so it only needs a quiet glow pulse to feel
     special, not the old moving shimmer that read as a separate banner
     bolted on top of the hero. Game of the Week glows gold against its own
     navy/blue badge — We-Draft's own palette, not a generic fire-orange —
     so it reads as "this site's top honor" rather than a stock hype color. */
  @keyframes wdGotwBadgePulse {
    0%, 100% { box-shadow: 0 4px 14px rgba(0,0,0,0.35); }
    50%      { box-shadow: 0 4px 22px rgba(246,162,29,0.65); }
  }
  .wd-gotw-badge { animation: wdGotwBadgePulse 2.6s ease-in-out infinite; }
  @keyframes wdFeaturedBadgePulse {
    0%, 100% { box-shadow: 0 4px 14px rgba(0,0,0,0.3); }
    50%      { box-shadow: 0 4px 18px rgba(246,162,29,0.55); }
  }
  .wd-featured-badge { animation: wdFeaturedBadgePulse 3.2s ease-in-out infinite; }

  /* Game of the Week — a slow pulsing gold glow around the whole card,
     matching the badge's own gold instead of the old fire-orange. */
  @keyframes wdGotwCardGlow {
    0%, 100% { box-shadow: 0 10px 30px rgba(0,0,0,0.12), 0 0 0px rgba(246,162,29,0); }
    50%      { box-shadow: 0 10px 32px rgba(0,0,0,0.14), 0 0 20px rgba(246,162,29,0.4); }
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

  /* Key Player hover note — the name+note stack sits in a fixed-height
     box (sized up front to fit both states) so revealing the note never
     changes the row's own height. Instead, hovering slides the name up
     to the top of that box and fades the note in underneath it, all
     within space that was already reserved — nothing below the row
     shifts, unlike an in-flow max-height reveal (which used to push
     every row down the moment the mouse landed, occasionally shoving
     that row out from under the cursor and flickering the hover state
     on/off in a loop). */
  .wd-keyplayer-name-anim { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); transition: top 0.2s ease, transform 0.2s ease; }
  .wd-perf-row-link:hover .wd-keyplayer-name-anim { top: 0; transform: translateY(0); }
  .wd-keyplayer-note-wrap { position: absolute; left: 0; right: 0; top: 25px; opacity: 0; pointer-events: none; transition: opacity 0.2s ease; }
  .wd-perf-row-link:hover .wd-keyplayer-note-wrap { opacity: 1; }

  /* Pick-form score inputs — plain number fields without the browser's
     up/down spinner clutter, since the field is big and tappable enough on
     its own. */
  .wd-no-spinner::-webkit-inner-spin-button, .wd-no-spinner::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .wd-no-spinner { -moz-appearance: textfield; }
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

// Admin enters Kickoff Time as a plain "HH:MM" with no timezone attached —
// CFB kickoffs are always quoted in US Eastern, so that's the zone assumed
// here (same helper as WePickHub.js's own kickoffMs). Reads the actual UTC
// offset for America/New_York on the game's own date via Intl instead of
// hardcoding UTC-5, so this stays correct across the EDT/EST switch partway
// through the season rather than drifting an hour on one side of it.
const ET_OFFSET_FALLBACK_MIN = -300; // EST — only used if Intl's parse ever fails
const etOffsetMinutesAt = (ms) => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(new Date(ms));
    const tz = parts.find((p) => p.type === "timeZoneName")?.value || "";
    const m = /GMT([+-]\d+)(?::(\d+))?/.exec(tz);
    if (!m) return ET_OFFSET_FALLBACK_MIN;
    const h = parseInt(m[1], 10);
    const mins = m[2] ? parseInt(m[2], 10) : 0;
    return h * 60 + (h < 0 ? -mins : mins);
  } catch {
    return ET_OFFSET_FALLBACK_MIN;
  }
};

// The actual UTC instant a game kicks off, combining a Date-ms value (UTC
// midnight) with Time (ET wall-clock) — null when either is missing, since
// Kickoff Time is optional in the admin form and there's no hour to lock at
// without one (picksLocked below falls back to Final-only locking then,
// same as before kickoff-locking existed).
const kickoffMsFromDate = (dateMs, time) => {
  const mins = timeToMinutes(time);
  if (!dateMs || mins == null) return null;
  return dateMs + mins * 60000 - etOffsetMinutesAt(dateMs) * 60000;
};

// Score picks unlock at 00:00 UTC on the Monday of the game's own week —
// same "Monday-to-Sunday, computed in UTC" boundary GameMarginSidebars.js
// uses for "this week", just anchored to an arbitrary game date instead of
// "now". A game's Date field is stored as UTC midnight, so this has to stay
// in UTC too or the Monday would drift by a day for anyone west of it.
const mondayOfWeekUtc = (ms) => {
  const d = new Date(ms);
  const utcDay = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (utcDay === 0 ? -6 : 1) - utcDay;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday, 0, 0, 0, 0);
};

const toMs = (ts) => {
  if (!ts) return 0;
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
};

// Which side a pick calls to win — "away" | "home" | null. Prefers the
// explicit pickedTeam field (always set for both score picks and the newer
// winner-only picks, see handleSavePick), falling back to comparing scores
// for picks written before pickedTeam existed, so old data keeps working
// without a migration.
const pickedSideOf = (p) => {
  if (p.pickedTeam === "away" || p.pickedTeam === "home") return p.pickedTeam;
  if (p.awayScore == null || p.homeScore == null) return null;
  if (p.awayScore > p.homeScore) return "away";
  if (p.homeScore > p.awayScore) return "home";
  return null;
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
// team's own color reads fine either way). If a school has no wordmark
// uploaded at all (or both fail to load), the backdrop falls back to the
// same LogoDark/Logo1 chain the foreground logo already uses below, rather
// than a school without a wordmark just going without a backdrop entirely.
// Sized as wide as the column will
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
  // Last resort once neither wordmark is available (missing or failed) —
  // same LogoDark-then-Logo1 chain as logoSrc below, just reused as the
  // backdrop image instead of going without one.
  const showLogoBackdrop = !showWordmarkDark && !showWordmarkFallback && !!logoSrc && !logoFailed;
  const backdropSrc = showWordmarkDark ? wordmarkDarkSrc
    : showWordmarkFallback ? wordmarkSrc
    : showLogoBackdrop ? sanitizeUrl(logoSrc)
    : null;

  const style = {
    position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    textDecoration: "none", flex: "1 1 0", minWidth: 0, width: 0,
    opacity: dimmed ? 0.55 : 1, transition: "opacity 0.3s ease",
  };

  const inner = (
    <>
      {backdropSrc && (
        <img
          src={backdropSrc} alt="" aria-hidden="true"
          onError={() => {
            if (showWordmarkDark) setWordmarkDarkFailed(true);
            else if (showWordmarkFallback) setWordmarkFailed(true);
            else setLogoFailed(true);
          }}
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

      {/* Name + mascot, stacked under the logo — same zIndex:1 as the logo
          so both sit above the backdrop wordmark, and part of the same
          Link/div school wraps everything in below, so clicking the name
          navigates to the team page exactly like clicking the logo does. */}
      <div style={{ position: "relative", zIndex: 1, textAlign: "center", marginTop: "16px" }}>
        <div style={{
          fontSize: isMobile ? "18px" : "30px", fontWeight: 900, color: "#fff",
          textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.15,
          textShadow: "0 2px 6px rgba(0,0,0,0.5)",
        }}>
          {school}
        </div>
        {schoolData?.Mascot && (
          <div style={{
            fontSize: isMobile ? "13px" : "19px", fontWeight: 700, color: "rgba(255,255,255,0.75)",
            textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "4px",
            textShadow: "0 1px 4px rgba(0,0,0,0.4)",
          }}>
            {schoolData.Mascot}
          </div>
        )}
      </div>
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
// moment there's some to show). Sits directly in the hero, below that
// team's own big logo (see the caller), so no mini-logo/team-label header
// is needed here anymore — which side this is is already obvious from
// position alone. A translucent glass panel (not a white card) so it reads
// as part of the same dark hero graphic instead of a light box bolted on
// top of it.
function TeamColumn({ schoolData, keyPlayers, performances, mode, keyPlayerNotes }) {
  const accent1 = schoolData?.Color1 || BLUE;
  const accent2 = schoolData?.Color2 || GOLD;
  const isFinalMode = mode === "final";
  const items = isFinalMode ? performances : keyPlayers;

  // A faded wordmark (dark version preferred, since it sits on a dark
  // panel — plain Wordmark as the fallback, not Logo1, which reads as a
  // small circular badge rather than filling the empty space) — or Logo1
  // as a last resort for a school with no wordmark art at all.
  const emptyWatermark = schoolData?.WordmarkDark || schoolData?.Wordmark || schoolData?.Logo1;

  return (
    <div style={{ position: "relative", border: "2px solid rgba(255,255,255,0.25)", borderRadius: "12px", overflow: "hidden", background: "rgba(0,0,0,0.28)", boxShadow: "0 6px 18px rgba(0,0,0,0.3)", minHeight: items.length === 0 ? "150px" : undefined }}>
      {items.length === 0 ? (
        // This side has nothing to show while the other one does (the
        // section wouldn't render at all if both were empty — see
        // showKeyPlayersSection) — just a big, faded watermark of the
        // team's own wordmark fills the space, no "nothing here" text.
        emptyWatermark && (
          <img
            src={sanitizeUrl(emptyWatermark)} alt="" aria-hidden="true"
            style={{
              position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              width: "70%", maxWidth: "220px", height: "auto", opacity: 0.35, objectFit: "contain", pointerEvents: "none",
            }}
          />
        )
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
              borderBottom: i < performances.length - 1 ? "1px solid rgba(255,255,255,0.15)" : "none",
              borderLeft: `4px solid ${accent2}`,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#fff", fontWeight: 900, fontSize: "16px", lineHeight: 1.3, textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>
                {perf.playerName || perf.titleShort}
              </div>
              {perf.statLine && (
                <div style={{ color: "rgba(255,255,255,0.75)", fontWeight: 700, fontSize: "12px", fontFamily: "'Courier New', monospace", letterSpacing: "0.02em", marginTop: "3px" }}>
                  {perf.statLine}
                </div>
              )}
            </div>
            <span className="wd-perf-row-chevron" style={{ color: GOLD, fontSize: "18px", fontWeight: 900, flexShrink: 0 }}>›</span>
          </Link>
        ))
      ) : (
        keyPlayers.map((p, i) => {
          // A player's own flair badge (same asset/config as their profile
          // page's hero) stands in for the team logo when they have one —
          // falls back to the team's own logo (LogoBlack/Logo1, same
          // light-background preference WePickHub.js uses, since this badge
          // sits on white) for players without a flair set, and only drops
          // to a bare rank number if the team has no logo on file either.
          const flairInfo = p.Flair ? FLAIR_CONFIG[String(p.Flair).trim()] : null;
          const fallbackLogo = schoolData?.LogoBlack || schoolData?.Logo1 || "";
          const note = keyPlayerNotes?.[p.id];
          return (
            <Link
              key={p.id}
              to={`/player/${p.Slug}`}
              className="wd-perf-row-link"
              style={{
                display: "flex", alignItems: "center", gap: "16px", padding: "16px 18px", textDecoration: "none",
                borderBottom: i < keyPlayers.length - 1 ? "1px solid rgba(255,255,255,0.15)" : "none",
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
              ) : fallbackLogo ? (
                <div style={{
                  flexShrink: 0, width: "46px", height: "46px", borderRadius: "10px",
                  background: "#fff", border: `2px solid ${accent2}`,
                  boxShadow: `0 0 12px ${accent2}66`,
                  display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                }}>
                  <img src={fallbackLogo} alt="" style={{ height: "78%", width: "78%", objectFit: "contain" }} />
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
                {note ? (
                  // Admin-written note (AdminPanel.js's CFB Schedule editor) —
                  // this box's height is fixed up front to fit both states, so
                  // hovering just slides the name to the top of it and fades
                  // the note in underneath, without changing the row's height.
                  <div style={{ position: "relative", height: "50px" }}>
                    <div className="wd-keyplayer-name-anim" style={{ color: "#fff", fontWeight: 900, fontSize: "19px", lineHeight: 1.2, textShadow: "0 1px 3px rgba(0,0,0,0.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.First} {p.Last}
                    </div>
                    <div className="wd-keyplayer-note-wrap">
                      <div style={{ color: "rgba(255,255,255,0.75)", fontWeight: 600, fontSize: "12.5px", lineHeight: 1.4, fontStyle: "italic", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {note}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: "#fff", fontWeight: 900, fontSize: "19px", lineHeight: 1.2, textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>{p.First} {p.Last}</div>
                )}
              </div>
              <span style={{
                background: accent1, color: "#fff", fontWeight: 900, fontSize: "12px",
                padding: "6px 13px", borderRadius: "6px", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0,
              }}>
                {p.Position || "—"}
              </span>
              <span className="wd-perf-row-chevron" style={{ color: GOLD, fontSize: "20px", fontWeight: 900, flexShrink: 0 }}>›</span>
            </Link>
          );
        })
      )}
    </div>
  );
}

export default function GamePage() {
  const { slug } = useParams();
  const { user, profile, login } = useAuth();
  const [game, setGame] = useState(null);
  const [awaySchool, setAwaySchool] = useState(null);
  const [homeSchool, setHomeSchool] = useState(null);
  // The broadcasting channel's logo (looked up by Name — see
  // CFBScheduleSection's own "TV Channel" field in AdminPanel.js), shown
  // under the at/vs button in the hero. null until game.Channel resolves
  // and its own fetch (below) finds a match; no channel set at all just
  // means this stays null forever, which the hero already treats as
  // "nothing to show" the same way it does for a missing school logo.
  const [channelLogo, setChannelLogo] = useState(null);
  const [keyPlayersAway, setKeyPlayersAway] = useState([]);
  const [keyPlayersHome, setKeyPlayersHome] = useState([]);
  const [performancesAway, setPerformancesAway] = useState([]);
  const [performancesHome, setPerformancesHome] = useState([]);
  const [picks, setPicks] = useState([]);
  const [verifiedByUid, setVerifiedByUid] = useState({});
  const [pickMode, setPickMode] = useState("score"); // "score" | "winner"
  const [pickAway, setPickAway] = useState("");
  const [pickHome, setPickHome] = useState("");
  const [pickWinnerSide, setPickWinnerSide] = useState(""); // "away" | "home", winner-only mode
  const [pickText, setPickText] = useState("");
  const [pickVisibility, setPickVisibility] = useState("public");
  const [pickSaving, setPickSaving] = useState(false);
  const [pickRemoving, setPickRemoving] = useState(false);
  const [pickMessage, setPickMessage] = useState("");
  const [rankedToggling, setRankedToggling] = useState(false);
  const [hypeUids, setHypeUids] = useState(new Set());
  const [hypeToggling, setHypeToggling] = useState(false);
  const [picksExpanded, setPicksExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  const contentRef = useRef(null);
  const pickFormRef = useRef(null);
  const communityPicksRef = useRef(null);

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
    setPicks([]);
    setVerifiedByUid({});
    setHypeUids(new Set());
    setPicksExpanded(false);
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

        const [awaySchoolSnap, homeSchoolSnap, keyAwaySnaps, keyHomeSnaps, perfSnap, picksSnap, hypeSnap] = await Promise.all([
          g.Away ? getDocs(query(collection(db, "schools"), where("School", "==", g.Away))) : null,
          g.Home ? getDocs(query(collection(db, "schools"), where("School", "==", g.Home))) : null,
          Promise.all(keyAwayIds.map((id) => getDoc(doc(db, "players", id)))),
          Promise.all(keyHomeIds.map((id) => getDoc(doc(db, "players", id)))),
          isFinal ? getDocs(query(collection(db, "performances"), where("gameId", "==", g.id), where("status", "==", "published"))) : null,
          getDocs(collection(db, "schedule26", g.id, "picks")),
          getDocs(collection(db, "schedule26", g.id, "hype")),
        ]);

        if (awaySchoolSnap && !awaySchoolSnap.empty) setAwaySchool({ id: awaySchoolSnap.docs[0].id, ...awaySchoolSnap.docs[0].data() });
        if (homeSchoolSnap && !homeSchoolSnap.empty) setHomeSchool({ id: homeSchoolSnap.docs[0].id, ...homeSchoolSnap.docs[0].data() });
        setKeyPlayersAway(keyAwaySnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() })));
        setKeyPlayersHome(keyHomeSnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() })));
        const loadedPicks = picksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPicks(loadedPicks);
        setHypeUids(new Set(hypeSnap.docs.map((d) => d.id)));

        // Batch-fetch each picker's users/{uid} doc for the "verified" badge,
        // same pattern PlayerProfile.js uses for community evaluations —
        // build a plain {uid: bool} map rather than storing whole profiles.
        const pickUids = [...new Set(loadedPicks.map((p) => p.id))];
        if (pickUids.length) {
          const userSnaps = await Promise.all(pickUids.map((uid) => getDoc(doc(db, "users", uid))));
          const vMap = {};
          userSnaps.forEach((s, idx) => { vMap[pickUids[idx]] = !!(s.exists() && s.data().verified); });
          setVerifiedByUid(vMap);
        }

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

  // Broadcasting channel's logo — a separate, independent lookup from the
  // main fetch above rather than folded into it, since it only ever
  // depends on game.Channel (itself only known once that fetch resolves)
  // and most games won't have one set at all.
  useEffect(() => {
    if (!game?.Channel) { setChannelLogo(null); return; }
    let cancelled = false;
    const loadChannel = async () => {
      try {
        const snap = await getDocs(query(collection(db, "tvChannels"), where("Name", "==", game.Channel)));
        if (cancelled) return;
        const data = snap.docs[0]?.data();
        setChannelLogo(data?.LogoDark || data?.Logo || null);
      } catch (e) {
        console.error("Channel logo fetch error:", e);
        if (!cancelled) setChannelLogo(null);
      }
    };
    loadChannel();
    return () => { cancelled = true; };
  }, [game?.Channel]);

  // Seeds the pick form from the signed-in user's own existing pick (if
  // any) once both are known — user/profile resolve from AuthContext on
  // their own timeline, separate from the game-data fetch above, so this
  // can't just live inside that effect.
  useEffect(() => {
    if (!user) {
      setPickAway(""); setPickHome(""); setPickText(""); setPickVisibility("public");
      setPickMode("score"); setPickWinnerSide("");
      return;
    }
    const mine = picks.find((p) => p.id === user.uid);
    if (mine) {
      const isWinnerOnly = mine.pickType === "winner" || mine.awayScore == null;
      setPickMode(isWinnerOnly ? "winner" : "score");
      setPickWinnerSide(isWinnerOnly ? (pickedSideOf(mine) || "") : "");
      setPickAway(mine.awayScore != null ? String(mine.awayScore) : "");
      setPickHome(mine.homeScore != null ? String(mine.homeScore) : "");
      setPickText(mine.prediction || "");
      setPickVisibility(mine.visibility || "public");
    }
  }, [user, picks]);

  const handleSavePick = async (gameId) => {
    if (!user) { login(); return; }
    let payload;
    if (pickMode === "winner") {
      if (!pickWinnerSide) {
        setPickMessage("Pick a team to win.");
        return;
      }
      payload = {
        uid: user.uid,
        displayName: profile?.username?.trim() || "Anonymous Fan",
        pickType: "winner",
        pickedTeam: pickWinnerSide,
        awayScore: null,
        homeScore: null,
        prediction: pickText.trim(),
        // Winner-only picks can never count toward Ranked — there's no
        // score to grade accuracy on — same rule We-Pick's My Picks tab
        // enforces (see handleToggleRanked below for the flip side).
        ranked: false,
        visibility: pickVisibility,
        updatedAt: serverTimestamp(),
      };
    } else {
      if (pickAway.trim() === "" || pickHome.trim() === "") {
        setPickMessage("Enter a predicted score for both teams.");
        return;
      }
      const awayScore = Math.max(0, Math.round(Number(pickAway)));
      const homeScore = Math.max(0, Math.round(Number(pickHome)));
      // Counting toward Ranked defaults ON the moment a real score gets
      // submitted (same default We-Pick's My Picks tab uses) — only
      // preserved from the existing pick when there was already a score to
      // have a real ranked choice attached to it, so upgrading a prior
      // winner-only pick's forced `ranked: false` still gets the same
      // default-on treatment as a brand new pick.
      const hadScore = myPick?.awayScore != null && myPick?.homeScore != null;
      payload = {
        uid: user.uid,
        displayName: profile?.username?.trim() || "Anonymous Fan",
        pickType: "score",
        pickedTeam: awayScore > homeScore ? "away" : homeScore > awayScore ? "home" : null,
        awayScore,
        homeScore,
        prediction: pickText.trim(),
        ranked: hadScore ? (myPick.ranked ?? true) : true,
        visibility: pickVisibility,
        updatedAt: serverTimestamp(),
      };
    }
    setPickSaving(true);
    setPickMessage("");
    try {
      // Canonical doc (public read, drives this page's aggregation) plus a
      // private mirror under the user's own account (see firestore.rules)
      // so We-Pick's My Picks page can list everything a user has picked
      // with one collection read instead of a collection-group query.
      await Promise.all([
        setDoc(doc(db, "schedule26", gameId, "picks", user.uid), payload),
        setDoc(doc(db, "users", user.uid, "picks", gameId), payload),
      ]);
      setPicks((prev) => [...prev.filter((p) => p.id !== user.uid), { id: user.uid, ...payload }]);
      setPickMessage("Pick saved!");

      // Confetti in the picked-to-win team's colors — falls back to the
      // site's own blue/gold on a tie, same call shape as the evaluation-
      // save confetti in PlayerProfile.js.
      const winnerSchool = payload.pickedTeam === "away" ? awaySchool : payload.pickedTeam === "home" ? homeSchool : null;
      const color1 = winnerSchool?.Color1 || "#002b5c";
      const color2 = winnerSchool?.Color2 || "#f4c430";
      confetti({ particleCount: 140, spread: 75, origin: { y: 0.65 }, colors: [color1, color2, "#ffffff"] });
    } catch (e) {
      console.error("Save pick error:", e);
      setPickMessage("Failed to save — try again.");
    } finally {
      setPickSaving(false);
    }
  };

  const handleRemovePick = async (gameId) => {
    if (!user) return;
    setPickRemoving(true);
    try {
      await Promise.all([
        deleteDoc(doc(db, "schedule26", gameId, "picks", user.uid)),
        deleteDoc(doc(db, "users", user.uid, "picks", gameId)),
      ]);
      setPicks((prev) => prev.filter((p) => p.id !== user.uid));
      setPickAway(""); setPickHome(""); setPickText(""); setPickVisibility("public");
      setPickMode("score"); setPickWinnerSide("");
      setPickMessage("");
    } catch (e) {
      console.error("Remove pick error:", e);
    } finally {
      setPickRemoving(false);
    }
  };

  // The same star-equivalent as We-Pick's My Picks tab, just reachable from
  // a game's own page — flips whether an existing score pick counts toward
  // this week's Ranked 6. Only meaningful once there's a score to grade
  // (a winner-only pick's `ranked` is permanently false, set in
  // handleSavePick), so this refuses with an explanatory alert rather than
  // silently doing nothing, same wording WePickHub.js's own star uses.
  const handleToggleRanked = async (gameId) => {
    if (!user || !myPick) return;
    if (myPick.awayScore == null || myPick.homeScore == null) {
      alert("Add a score to this pick before it can count toward Ranked.");
      return;
    }
    const { id, ...rest } = myPick;
    const payload = { ...rest, ranked: !myPick.ranked, updatedAt: serverTimestamp() };
    setRankedToggling(true);
    try {
      await Promise.all([
        setDoc(doc(db, "schedule26", gameId, "picks", user.uid), payload, { merge: true }),
        setDoc(doc(db, "users", user.uid, "picks", gameId), payload, { merge: true }),
      ]);
      setPicks((prev) => prev.map((p) => (p.id === user.uid ? { ...p, ranked: payload.ranked } : p)));
    } catch (e) {
      console.error("Toggle ranked error:", e);
    } finally {
      setRankedToggling(false);
    }
  };

  const handleToggleHype = async (gameId) => {
    if (!user) { login(); return; }
    setHypeToggling(true);
    const hypeRef = doc(db, "schedule26", gameId, "hype", user.uid);
    const alreadyHyped = hypeUids.has(user.uid);
    try {
      if (alreadyHyped) {
        await deleteDoc(hypeRef);
        setHypeUids((prev) => { const next = new Set(prev); next.delete(user.uid); return next; });
      } else {
        await setDoc(hypeRef, { uid: user.uid, createdAt: serverTimestamp() });
        setHypeUids((prev) => new Set(prev).add(user.uid));
      }
    } catch (e) {
      console.error("Toggle hype error:", e);
    } finally {
      setHypeToggling(false);
    }
  };

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

  // Picks unlock at 00:00 UTC the Monday of the game's own week — before
  // that, PicksForceOpen (an admin override, see AdminPanel.js) is the only
  // way in. Week 0 is opened unconditionally instead, same special case as
  // WePickHub.js's own isPickable — it kicks off before every other week,
  // so there's no reason to make people wait on the calendar for it
  // specifically. None of that overrides actual kickoff, though: once the
  // ball's in the air picks lock for good regardless of PicksForceOpen or
  // week, same as isFinal already did for a game once it's over.
  const picksOpenAtMs = gameDateMs ? mondayOfWeekUtc(gameDateMs) : 0;
  const picksDateReached = !gameDateMs || Date.now() >= picksOpenAtMs;
  const kickoffAtMs = kickoffMsFromDate(gameDateMs, game.Time);
  const kickoffPassed = kickoffAtMs != null && Date.now() >= kickoffAtMs;
  const picksLocked = !isFinal && (kickoffPassed || (game.Week !== "Week 0" && !game.PicksForceOpen && !picksDateReached));
  const myPick = user ? picks.find((p) => p.id === user.uid) : null;
  // Picks with an actual written prediction lead the feed — those are the
  // ones worth reading, not just a bare score/winner call — then verified
  // pickers within each of those groups (the layer that was already here),
  // then most-recently-updated as the final tiebreaker.
  const publicPicks = picks.filter((p) => p.visibility === "public").sort((a, b) => {
    const aHasDesc = !!a.prediction?.trim();
    const bHasDesc = !!b.prediction?.trim();
    if (aHasDesc && !bHasDesc) return -1;
    if (!aHasDesc && bHasDesc) return 1;
    const aVerified = !!verifiedByUid[a.id];
    const bVerified = !!verifiedByUid[b.id];
    if (aVerified && !bVerified) return -1;
    if (!aVerified && bVerified) return 1;
    return toMs(b.updatedAt) - toMs(a.updatedAt);
  });
  const hypeCount = hypeUids.size;
  const iHyped = user ? hypeUids.has(user.uid) : false;
  const pickCount = picks.length;
  // Averages only count picks that actually carry a score — a winner-only
  // pick (see pickMode) has none, and would otherwise silently drag the
  // average down toward 0 by averaging in a missing score as zero.
  const scoredPicks = picks.filter((p) => p.awayScore != null && p.homeScore != null);
  const avgAwayScore = scoredPicks.length ? Math.round(scoredPicks.reduce((s, p) => s + p.awayScore, 0) / scoredPicks.length) : null;
  const avgHomeScore = scoredPicks.length ? Math.round(scoredPicks.reduce((s, p) => s + p.homeScore, 0) / scoredPicks.length) : null;
  const awayPickWins = picks.filter((p) => pickedSideOf(p) === "away").length;
  const homePickWins = picks.filter((p) => pickedSideOf(p) === "home").length;
  const awayWinPct = pickCount ? Math.round((awayPickWins / pickCount) * 100) : 0;
  const homeWinPct = pickCount ? Math.round((homePickWins / pickCount) * 100) : 0;
  // "Back" always means this game's week slate — the CFB schedule for that
  // week (every game, not just the ones with performances) — not the
  // Performances hub. Only falls back to the CFB schedule's own default
  // (current week) if this game somehow has no Week on file.
  const weekSlateUrl = game.Week ? `/cfb/schedule/${encodeURIComponent(game.Week)}` : "/cfb/schedule";
  const weekSlateLabel = game.Week ? `← ${game.Week} Slate` : "← Full Schedule";

  const canonicalUrl = `https://we-draft.com/game/${game.Slug}`;
  const seoTitle = `${game.Away} vs ${game.Home} | Football Game Predictions, Where to Watch, and Key Players`;
  // Date (+ kickoff time, pregame only — a final game's "at 7:00 PM" reads
  // stale once it's over) always leads, then whatever prediction content
  // actually exists: the community's own aggregate picks if there are any,
  // else a plain nudge to go look at (or make) one, per the "we haven't
  // graded this yet" instruction rather than inventing numbers.
  const seoDateTime = dateStr ? (!isFinal && timeStr ? `${dateStr} at ${timeStr}` : dateStr) : "";
  const seoPredictedWinner = awayWinPct > homeWinPct ? game.Away : homeWinPct > awayWinPct ? game.Home : null;
  const seoPredictionSummary = pickCount > 0
    ? `The We-Draft community${seoPredictedWinner ? ` favors ${seoPredictedWinner}` : ""}${avgAwayScore != null && avgHomeScore != null ? `, projecting a final score of ${game.Away} ${avgAwayScore}–${game.Home} ${avgHomeScore}` : ""} across ${pickCount} prediction${pickCount === 1 ? "" : "s"}.`
    : "See the community's score predictions for this game, or make your own prediction and share your scouting notes on We-Draft.com.";
  const seoDescription = `${seoDateTime ? `${seoDateTime}. ` : ""}${seoPredictionSummary}`;

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
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginLeft: "auto" }}>
              {!isFinal && (
                <button
                  onClick={() => pickFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  style={{
                    color: "#fff", background: GOLD, border: `2px solid ${GOLD}`,
                    borderRadius: "8px", padding: isMobile ? "7px 14px" : "9px 22px", cursor: "pointer",
                    fontWeight: 900, fontSize: isMobile ? "13px" : "15px",
                    textTransform: "uppercase", letterSpacing: "0.04em",
                  }}
                >
                  🔮 Pick This Game
                </button>
              )}
              <button
                onClick={() => communityPicksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                style={{
                  color: "#fff", background: "rgba(255,255,255,0.14)", border: `2px solid ${GOLD}`,
                  borderRadius: "8px", padding: isMobile ? "7px 14px" : "9px 22px", cursor: "pointer",
                  fontWeight: 900, fontSize: isMobile ? "13px" : "15px",
                  textTransform: "uppercase", letterSpacing: "0.04em",
                }}
              >
                📊 View Picks
              </button>
              <Link
                to={weekSlateUrl}
                style={{
                  color: "#fff", background: "rgba(255,255,255,0.14)", border: `2px solid ${GOLD}`,
                  borderRadius: "8px", padding: isMobile ? "7px 14px" : "9px 22px",
                  fontWeight: 900, fontSize: isMobile ? "13px" : "15px", textDecoration: "none",
                  textTransform: "uppercase", letterSpacing: "0.04em",
                }}
              >
                {weekSlateLabel}
              </Link>
            </div>
          </div>
          <div style={{ height: "3px", background: GOLD }} />

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
              light either team's color happens to be). Each team's own
              Color2 used to also glow in from that side's own two corners,
              but that's been dropped — just the plain Color1 blend now. */}
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

            {/* Game of the Week / Featured badge — sits right inside the
                hero now (used to be its own separate banner strip above it)
                so it reads as part of the same graphic instead of a
                disconnected announcement bolted on top. Still gets its own
                glow so it doesn't disappear into the background, just
                without the old moving shimmer — a slow box-shadow pulse via
                wd-gotw-badge/wd-featured-badge below is plenty of "this one
                matters" without being distracting. */}
            {(game.GameOfWeek || game.Featured) && (
              <div style={{ position: "relative", zIndex: 1, textAlign: "center", marginBottom: isMobile ? "18px" : "26px" }}>
                <span
                  className={game.GameOfWeek ? "wd-gotw-badge" : "wd-featured-badge"}
                  style={{
                    display: "inline-block",
                    background: game.GameOfWeek ? `linear-gradient(90deg, #003d82, ${BLUE}, #003d82)` : `linear-gradient(90deg, ${GOLD}, #ffe08a)`,
                    color: game.GameOfWeek ? GOLD : "#3a2900",
                    fontWeight: 900, fontSize: isMobile ? "11px" : "14px",
                    padding: isMobile ? "6px 16px" : "8px 22px", borderRadius: "20px",
                    textTransform: "uppercase", letterSpacing: "0.14em",
                    border: `2px solid ${game.GameOfWeek ? GOLD : "rgba(255,255,255,0.4)"}`,
                    textShadow: game.GameOfWeek ? "0 1px 2px rgba(0,0,0,0.4)" : "0 1px 2px rgba(255,255,255,0.35)",
                  }}
                >
                  {game.GameOfWeek ? "🏈 We-Draft.com's Game of the Week 🏈" : "🏈 We-Draft.com's Featured Game"}
                </span>
              </div>
            )}

            {/* alignItems: stretch (not flex-start) so each TeamHeroSide
                column takes the full row height — its own justifyContent:
                "center" then centers the logo+name+mascot block within
                that instead of it sitting pinned to the top with empty
                space below. The center column's own content still just
                stacks from the top via its paddingTop, unaffected by
                being stretched taller. */}
            <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "stretch", justifyContent: "center", gap: isMobile ? "12px" : "36px" }}>
              <TeamHeroSide key={`${game.id}-away`} school={game.Away} schoolData={awaySchool} isMobile={isMobile} dimmed={isFinal && homeWon} />

              <div style={{ textAlign: "center", flexShrink: 0, paddingTop: isMobile ? "26px" : "58px" }}>
                {isFinal ? (
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: isMobile ? "8px" : "14px",
                    background: "rgba(0,0,0,0.32)", border: "2px solid rgba(255,255,255,0.25)",
                    borderRadius: "14px", padding: isMobile ? "8px 14px" : "14px 26px",
                    boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
                    width: "fit-content", margin: "0 auto",
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
                    margin: "0 auto",
                  }}>
                    <span style={{ fontSize: isMobile ? "13px" : "22px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {game.Neutral ? "vs" : "at"}
                    </span>
                  </div>
                )}
                {game.Neutral && (
                  <div style={{ fontSize: "9px", fontWeight: 900, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "8px" }}>Neutral Site</div>
                )}
                {/* Broadcasting channel — set via CFB Schedule's "TV Channel"
                    field, logo managed in Misc Branding (see channelLogo's
                    own fetch above). Sits between the at/vs button and Hype,
                    never both final-score-box and channel logo competing for
                    the same slot since this renders regardless of isFinal. */}
                {channelLogo && (
                  <img
                    src={sanitizeUrl(channelLogo)} alt={game.Channel} title={game.Channel}
                    style={{ height: isMobile ? "68px" : "100px", maxWidth: isMobile ? "240px" : "340px", objectFit: "contain", margin: "10px auto 0", display: "block", filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.4))" }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                )}
                <button
                  onClick={() => handleToggleHype(game.id)}
                  disabled={hypeToggling}
                  title={user ? (iHyped ? "Remove hype" : "Hype this game") : "Sign in to hype this game"}
                  style={{
                    marginTop: "14px", marginLeft: "auto", marginRight: "auto",
                    width: "fit-content", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                    background: iHyped ? "linear-gradient(90deg, #ff6a00, #ffb347)" : "rgba(0,0,0,0.32)",
                    border: `2px solid ${iHyped ? "#ffb347" : "rgba(255,255,255,0.35)"}`,
                    borderRadius: "20px", padding: isMobile ? "6px 12px" : "7px 16px", cursor: hypeToggling ? "default" : "pointer",
                    color: "#fff", fontWeight: 900, fontSize: isMobile ? "11px" : "13px",
                    boxShadow: iHyped ? "0 4px 14px rgba(255,106,0,0.45)" : "0 4px 10px rgba(0,0,0,0.3)",
                    opacity: hypeToggling ? 0.7 : 1, transition: "background 0.15s, box-shadow 0.15s",
                  }}
                >
                  <span>🔥</span>
                  <span>{iHyped ? "Hyped" : "Hype"}</span>
                  <span style={{ color: iHyped ? "#3a1200" : "rgba(255,255,255,0.7)" }}>{hypeCount}</span>
                </button>

                {/* Fans-predict snapshot — the same average score + win-split
                    bar the Community Picks card below computes, surfaced
                    here too so the excitement (and the pulse of what
                    everyone's calling it) is visible without scrolling. */}
                {pickCount > 0 && (
                  <div style={{
                    marginTop: "14px", marginLeft: "auto", marginRight: "auto",
                    width: "fit-content", background: "rgba(0,0,0,0.32)", border: "2px solid rgba(255,255,255,0.25)",
                    borderRadius: "10px", padding: isMobile ? "8px 12px" : "10px 16px",
                    minWidth: isMobile ? "130px" : "170px", boxShadow: "0 6px 16px rgba(0,0,0,0.3)",
                  }}>
                    <div style={{ fontSize: "9px", fontWeight: 900, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.1em", textAlign: "center", marginBottom: "6px" }}>
                      Fans Predict
                    </div>
                    {scoredPicks.length > 0 && (
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: "8px", marginBottom: "8px" }}>
                        <span style={{ fontSize: isMobile ? "20px" : "26px", fontWeight: 900, color: awayWinPct >= homeWinPct ? "#fff" : "rgba(255,255,255,0.5)", lineHeight: 1 }}>{avgAwayScore}</span>
                        <span style={{ fontSize: "13px", fontWeight: 900, color: "rgba(255,255,255,0.4)" }}>–</span>
                        <span style={{ fontSize: isMobile ? "20px" : "26px", fontWeight: 900, color: homeWinPct > awayWinPct ? "#fff" : "rgba(255,255,255,0.5)", lineHeight: 1 }}>{avgHomeScore}</span>
                      </div>
                    )}
                    <div style={{ display: "flex", height: "7px", borderRadius: "5px", overflow: "hidden", background: "rgba(255,255,255,0.15)" }}>
                      <div style={{ width: `${awayWinPct}%`, background: awayColor }} />
                      <div style={{ width: `${homeWinPct}%`, background: homeColor }} />
                    </div>
                  </div>
                )}
              </div>

              <TeamHeroSide key={`${game.id}-home`} school={game.Home} schoolData={homeSchool} isMobile={isMobile} dimmed={isFinal && awayWon} />
            </div>

            {/* The admin-written Preview/Recap (game.Notes) — used to live
                far down the page below Community Picks; now sits right in
                the hero, above Key Players/Top Performances, restyled as a
                translucent glass card so it reads as part of the same dark
                graphic instead of a plain white box further down. */}
            {game.Notes && (
              <div style={{ position: "relative", zIndex: 1, marginTop: isMobile ? "26px" : "40px", maxWidth: "700px", marginLeft: "auto", marginRight: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "15px" }}>{isFinal ? "📰" : "🔮"}</span>
                  <span style={{ color: "#fff", fontSize: isMobile ? "11px" : "13px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", textShadow: "0 2px 5px rgba(0,0,0,0.4)" }}>
                    {isFinal ? "The Recap" : "The Preview"}
                  </span>
                </div>
                <div style={{
                  fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 700,
                  fontSize: isMobile ? "13.5px" : "15px", letterSpacing: "0.01em",
                  lineHeight: 1.6, color: "#fff", whiteSpace: "pre-wrap", wordWrap: "break-word",
                  background: "rgba(0,0,0,0.32)", border: "2px solid rgba(255,255,255,0.25)",
                  borderLeft: `4px solid ${GOLD}`, borderRadius: "4px 10px 10px 4px",
                  padding: isMobile ? "14px 16px" : "18px 24px",
                  boxShadow: "0 6px 18px rgba(0,0,0,0.3)",
                }}>
                  {game.Notes}
                </div>
              </div>
            )}

            {/* Key Players (pregame) or Top Performances (final) — living
                right in the hero, below the big logos, instead of stacked
                far down the page under Notes, so this shows up as part of
                the same matchup graphic rather than a separate section a
                visitor might never scroll to. */}
            {showKeyPlayersSection && (
              <div style={{ position: "relative", zIndex: 1, marginTop: isMobile ? "18px" : "24px" }}>
                <div style={{ textAlign: "center", marginBottom: "14px" }}>
                  <span style={{ color: "#fff", fontSize: isMobile ? "13px" : "15px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", textShadow: "0 2px 6px rgba(0,0,0,0.5)" }}>
                    {isFinal ? "Top Performances" : "Key Players"}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? "16px" : "24px" }}>
                  <TeamColumn
                    schoolData={awaySchool}
                    keyPlayers={keyPlayersAway}
                    performances={performancesAway}
                    mode={isFinal ? "final" : "pregame"}
                    keyPlayerNotes={game.KeyPlayerNotes}
                  />
                  <TeamColumn
                    schoolData={homeSchool}
                    keyPlayers={keyPlayersHome}
                    performances={performancesHome}
                    mode={isFinal ? "final" : "pregame"}
                    keyPlayerNotes={game.KeyPlayerNotes}
                  />
                </div>
              </div>
            )}
          </div>
          <div style={{ height: "3px", background: GOLD }} />

          {/* Body */}
          <div style={{ background: "#fff", padding: isMobile ? "20px 16px" : "32px 32px" }}>

            {/* Make Your Pick — predict the score, optionally leave a note,
                public or private. Locked pre-Monday (or once Final) unless
                an admin has forced it open (see AdminPanel.js). */}
            <div ref={pickFormRef} style={{ marginBottom: "28px" }}>
              <div style={{ border: `2px solid ${BLUE}`, borderRadius: "12px", overflow: "hidden", boxShadow: "0 6px 18px rgba(0,0,0,0.08)" }}>
                <div style={{ background: `linear-gradient(90deg, ${BLUE}, #003d82)`, padding: "12px 18px" }}>
                  <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    🔮 Make Your Pick
                  </div>
                </div>
                <div style={{ height: "3px", background: GOLD }} />

                {/* Body sits on the same team-color/dark-overlay gradient and
                    drifting field texture as the hero above, instead of a
                    flat white panel, so the pick form reads as part of the
                    same charged matchup graphic rather than a bland utility
                    box bolted on underneath it. */}
                <div style={{
                  position: "relative", overflow: "hidden",
                  background: [
                    "linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5))",
                    `linear-gradient(90deg, ${awayColor} 0%, ${awayColor} 30%, ${homeColor} 70%, ${homeColor} 100%)`,
                  ].join(", "),
                  padding: isMobile ? "20px 16px" : "28px 32px",
                }}>
                  <div aria-hidden="true" style={{
                    position: "absolute", inset: "-20%", zIndex: 0, pointerEvents: "none",
                    background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 2px, transparent 2px, transparent 40px)",
                    animation: "wdFieldDrift 20s linear infinite",
                  }} />
                  <div style={{ position: "relative", zIndex: 1 }}>
                  {!user ? (
                    <div style={{ textAlign: "center" }}>
                      <p style={{ fontSize: "14px", fontWeight: 700, color: "#fff", marginBottom: "14px", textShadow: "0 2px 6px rgba(0,0,0,0.4)" }}>
                        Sign in to predict the score of this game.
                      </p>
                      <button
                        onClick={login}
                        style={{ background: GOLD, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "11px 26px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.35)" }}
                      >
                        Sign In
                      </button>
                    </div>
                  ) : isFinal ? (
                    <div style={{ textAlign: "center", color: "rgba(255,255,255,0.85)", fontStyle: "italic", fontSize: "13px" }}>
                      Picks are closed — this game is final.
                      {myPick && (
                        <div style={{ marginTop: "10px", fontStyle: "normal", fontWeight: 800, color: "#fff" }}>
                          {myPick.awayScore != null && myPick.homeScore != null
                            ? `Your pick: ${game.Away} ${myPick.awayScore} – ${game.Home} ${myPick.homeScore}`
                            : `Your pick: ${pickedSideOf(myPick) === "away" ? game.Away : pickedSideOf(myPick) === "home" ? game.Home : "—"} to win`}
                        </div>
                      )}
                    </div>
                  ) : picksLocked ? (
                    <div style={{ textAlign: "center", color: "rgba(255,255,255,0.85)", fontStyle: "italic", fontSize: "13px" }}>
                      Pick this game starting {new Date(picksOpenAtMs).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}.
                    </div>
                  ) : (
                    <>
                      {/* Score prediction vs. just calling the winner — two
                          different, mutually exclusive shapes of pick (see
                          pickMode/handleSavePick), toggled here rather than
                          being two separate forms. */}
                      <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginBottom: "20px" }}>
                        {[["score", "🔢 Predict the Score"], ["winner", "✅ Just Pick a Winner"]].map(([key, label]) => (
                          <button
                            key={key}
                            onClick={() => setPickMode(key)}
                            style={{
                              background: pickMode === key ? GOLD : "rgba(0,0,0,0.32)",
                              color: pickMode === key ? "#fff" : "rgba(255,255,255,0.75)",
                              border: `2px solid ${pickMode === key ? GOLD : "rgba(255,255,255,0.35)"}`,
                              borderRadius: "20px", padding: isMobile ? "7px 14px" : "8px 18px", cursor: "pointer",
                              fontWeight: 900, fontSize: isMobile ? "11px" : "13px",
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {pickMode === "score" ? (
                        /* Teams stack vertically right on the hero-style
                           background, left-aligned (away first, home second)
                           instead of sitting in their own white cards — the
                           only white left in this whole form is the score
                           inputs themselves and the textarea below. Names get
                           flex:1 + ellipsis (never wrap to a second line) so
                           both rows' score inputs land at the exact same x
                           position regardless of name length. */
                        <div style={{ display: "flex", flexDirection: "column", gap: "18px", maxWidth: isMobile ? "100%" : "600px", margin: "0 auto 22px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                            {(awaySchool?.LogoDark || awaySchool?.Logo1) && (
                              <img src={sanitizeUrl(awaySchool.LogoDark || awaySchool.Logo1)} alt={game.Away} style={{ width: "52px", height: "52px", objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.5))" }} />
                            )}
                            <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#fff", fontWeight: 900, fontSize: isMobile ? "17px" : "26px", textTransform: "uppercase", letterSpacing: "0.01em", textShadow: "0 2px 6px rgba(0,0,0,0.5)", lineHeight: 1.05 }}>{game.Away}</span>
                            <input
                              type="number" min="0" inputMode="numeric" value={pickAway}
                              onChange={(e) => setPickAway(e.target.value)}
                              className="wd-no-spinner"
                              style={{ width: "72px", flexShrink: 0, textAlign: "center", fontSize: "28px", fontWeight: 900, border: `2px solid ${awayColor}`, borderRadius: "8px", padding: "6px", color: awayColor, outline: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.35)" }}
                            />
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                            {(homeSchool?.LogoDark || homeSchool?.Logo1) && (
                              <img src={sanitizeUrl(homeSchool.LogoDark || homeSchool.Logo1)} alt={game.Home} style={{ width: "52px", height: "52px", objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.5))" }} />
                            )}
                            <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#fff", fontWeight: 900, fontSize: isMobile ? "17px" : "26px", textTransform: "uppercase", letterSpacing: "0.01em", textShadow: "0 2px 6px rgba(0,0,0,0.5)", lineHeight: 1.05 }}>{game.Home}</span>
                            <input
                              type="number" min="0" inputMode="numeric" value={pickHome}
                              onChange={(e) => setPickHome(e.target.value)}
                              className="wd-no-spinner"
                              style={{ width: "72px", flexShrink: 0, textAlign: "center", fontSize: "28px", fontWeight: 900, border: `2px solid ${homeColor}`, borderRadius: "8px", padding: "6px", color: homeColor, outline: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.35)" }}
                            />
                          </div>
                        </div>
                      ) : (
                        /* Winner-only — no score fields at all, just two big
                           tappable team cards; the selected one gets a solid
                           gold border/fill so the choice reads at a glance. */
                        <div style={{ display: "flex", gap: isMobile ? "10px" : "16px", justifyContent: "center", marginBottom: "22px", flexWrap: "wrap" }}>
                          {[["away", game.Away, awaySchool, awayColor], ["home", game.Home, homeSchool, homeColor]].map(([side, name, schoolData, color]) => (
                            <button
                              key={side}
                              onClick={() => setPickWinnerSide(side)}
                              style={{
                                flex: "1 1 150px", maxWidth: "220px", display: "flex", flexDirection: "column", alignItems: "center",
                                gap: "8px", padding: isMobile ? "16px 12px" : "20px 16px", borderRadius: "14px", cursor: "pointer",
                                background: pickWinnerSide === side ? color : "rgba(0,0,0,0.32)",
                                border: `3px solid ${pickWinnerSide === side ? GOLD : "rgba(255,255,255,0.3)"}`,
                                boxShadow: pickWinnerSide === side ? "0 6px 18px rgba(0,0,0,0.4)" : "none",
                                transition: "background 0.15s, border-color 0.15s",
                              }}
                            >
                              {(schoolData?.LogoDark || schoolData?.Logo1) && (
                                <img src={sanitizeUrl(schoolData.LogoDark || schoolData.Logo1)} alt={name} style={{ width: "48px", height: "48px", objectFit: "contain" }} />
                              )}
                              <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? "13px" : "15px", textTransform: "uppercase", letterSpacing: "0.02em", textAlign: "center", textShadow: "0 2px 4px rgba(0,0,0,0.5)" }}>
                                {name}
                              </span>
                              {pickWinnerSide === side && (
                                <span style={{ color: GOLD, fontWeight: 900, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>✓ Selected</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                      <textarea
                        value={pickText}
                        onChange={(e) => setPickText(e.target.value)}
                        placeholder="Why do you like this pick? Call out the key matchup, a player to watch, anything. (optional)"
                        rows={4}
                        style={{ width: "100%", border: "none", borderRadius: "10px", padding: "14px 16px", fontFamily: "inherit", fontSize: "14px", fontWeight: 600, marginBottom: "16px", boxSizing: "border-box", resize: "vertical", outline: "none", lineHeight: 1.5, boxShadow: "0 4px 14px rgba(0,0,0,0.3)" }}
                      />
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", background: "rgba(0,0,0,0.32)", border: "2px solid rgba(255,255,255,0.25)", borderRadius: "10px", padding: "14px 16px" }}>
                        <div>
                          <div style={{ fontSize: "10px", fontWeight: 900, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>Visibility</div>
                          <select
                            value={pickVisibility}
                            onChange={(e) => setPickVisibility(e.target.value)}
                            style={{ border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "9px 12px", fontWeight: 800, fontSize: "12px", color: BLUE, outline: "none", background: "#fff" }}
                          >
                            <option value="public">🌍 Public — shown in Community Picks</option>
                            <option value="private">🔒 Private — counts, name hidden</option>
                          </select>
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {/* Same star-equivalent as We-Pick's My Picks tab
                              (handleToggleRanked) — only shown once there's
                              an actual pick to flag, never for a game an
                              admin's disqualified from Ranked entirely. */}
                          {myPick && !game.RankedDisqualified && (
                            <button
                              onClick={() => handleToggleRanked(game.id)}
                              disabled={rankedToggling}
                              title={myPick.awayScore != null && myPick.homeScore != null
                                ? (myPick.ranked ? "Counts toward Ranked — click to remove" : "Click to count this pick toward Ranked")
                                : "Add a score to count this pick toward Ranked"}
                              style={{
                                display: "flex", alignItems: "center", gap: "6px",
                                background: myPick.ranked ? GOLD : "rgba(255,255,255,0.12)",
                                color: myPick.ranked ? "#fff" : "rgba(255,255,255,0.8)",
                                border: `2px solid ${myPick.ranked ? GOLD : "rgba(255,255,255,0.35)"}`,
                                borderRadius: "8px", padding: "11px 16px", fontWeight: 900, fontSize: "12px",
                                cursor: rankedToggling ? "default" : "pointer", opacity: rankedToggling ? 0.6 : 1,
                              }}
                            >
                              <span style={{ filter: myPick.ranked ? "none" : "grayscale(1) opacity(0.6)" }}>⭐</span>
                              {myPick.ranked ? "Ranked" : "Count for Ranked"}
                            </button>
                          )}
                          {myPick && (
                            <button
                              onClick={() => handleRemovePick(game.id)}
                              disabled={pickRemoving}
                              style={{ background: "#fff", color: "#c0392b", border: "2px solid #c0392b", borderRadius: "8px", padding: "11px 18px", fontWeight: 900, fontSize: "12px", cursor: pickRemoving ? "default" : "pointer", opacity: pickRemoving ? 0.6 : 1 }}
                            >
                              {pickRemoving ? "Removing…" : "Remove Pick"}
                            </button>
                          )}
                          <button
                            onClick={() => handleSavePick(game.id)}
                            disabled={pickSaving}
                            style={{ background: GOLD, color: "#fff", border: "2px solid #fff", borderRadius: "8px", padding: "11px 24px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.04em", cursor: pickSaving ? "default" : "pointer", opacity: pickSaving ? 0.6 : 1, boxShadow: "0 4px 14px rgba(0,0,0,0.4)" }}
                          >
                            {pickSaving ? "Saving…" : myPick ? "Update Pick" : "Save Pick"}
                          </button>
                        </div>
                      </div>
                      {pickMessage && (
                        <div style={{ marginTop: "10px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: pickMessage.startsWith("Failed") || pickMessage.startsWith("Enter") ? "#ffb3a7" : "#8ef0a5", textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}>
                          {pickMessage}
                        </div>
                      )}
                    </>
                  )}
                  </div>
                </div>
              </div>
            </div>

            {/* Community Picks — aggregate score/win-split stats across
                everyone's picks (private ones included in the numbers),
                plus a feed of the public ones' names and notes. */}
            <div ref={communityPicksRef} style={{ marginBottom: "28px" }}>
              <div style={{ border: `2px solid ${BLUE}`, borderRadius: "12px", overflow: "hidden" }}>
                <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ color: GOLD, fontWeight: 900, fontSize: isMobile ? "15px" : "18px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    📊 We-Draft.com Community Picks
                  </div>
                  <div style={{ color: "#fff", background: "rgba(255,255,255,0.18)", fontSize: isMobile ? "13px" : "15px", fontWeight: 900, padding: "5px 14px", borderRadius: "20px" }}>
                    {pickCount} pick{pickCount !== 1 ? "s" : ""}
                  </div>
                </div>
                <div style={{ height: "3px", background: GOLD }} />
                <div style={{ padding: isMobile ? "16px" : "20px 24px" }}>
                  {pickCount === 0 ? (
                    // "Be the first to call it" is an invitation to act — not
                    // one worth making while picks aren't even open yet (the
                    // pick form above already explains when they will be).
                    picksLocked ? null : (
                      <div style={{ textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>
                        No picks yet — be the first to call it.
                      </div>
                    )
                  ) : (
                    <>
                      {/* Each side gets a card tinted/bordered in its own
                          team color, with the community's favorite called
                          out (colored score, colored card) instead of both
                          sides rendering identically in flat site-blue —
                          the logos make it instantly clear whose colors
                          are whose, not just which name is on top. */}
                      <div style={{ display: "flex", justifyContent: "center", textAlign: "center", marginBottom: "16px", flexWrap: "wrap", gap: isMobile ? "10px" : "16px" }}>
                        <div style={{
                          flex: "1 1 150px", maxWidth: "220px", padding: isMobile ? "14px 10px" : "16px 14px",
                          borderRadius: "12px", background: awayWinPct >= homeWinPct ? `${awayColor}14` : "#fafafa",
                          border: `2px solid ${awayWinPct >= homeWinPct ? awayColor : "#eee"}`,
                        }}>
                          {awaySchool?.Logo1 && (
                            <img src={sanitizeUrl(awaySchool.Logo1)} alt="" style={{ width: "34px", height: "34px", objectFit: "contain", marginBottom: "6px" }} />
                          )}
                          <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 900, color: "#888", textTransform: "uppercase", marginBottom: "6px" }}>{game.Away}</div>
                          {scoredPicks.length > 0 && (
                            <div style={{ fontSize: isMobile ? "40px" : "48px", fontWeight: 900, color: awayColor, lineHeight: 1 }}>{avgAwayScore}</div>
                          )}
                          <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: "#666", marginTop: "6px" }}>{awayWinPct}% picked to win</div>
                        </div>
                        <div style={{
                          flex: "1 1 150px", maxWidth: "220px", padding: isMobile ? "14px 10px" : "16px 14px",
                          borderRadius: "12px", background: homeWinPct > awayWinPct ? `${homeColor}14` : "#fafafa",
                          border: `2px solid ${homeWinPct > awayWinPct ? homeColor : "#eee"}`,
                        }}>
                          {homeSchool?.Logo1 && (
                            <img src={sanitizeUrl(homeSchool.Logo1)} alt="" style={{ width: "34px", height: "34px", objectFit: "contain", marginBottom: "6px" }} />
                          )}
                          <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 900, color: "#888", textTransform: "uppercase", marginBottom: "6px" }}>{game.Home}</div>
                          {scoredPicks.length > 0 && (
                            <div style={{ fontSize: isMobile ? "40px" : "48px", fontWeight: 900, color: homeColor, lineHeight: 1 }}>{avgHomeScore}</div>
                          )}
                          <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: "#666", marginTop: "6px" }}>{homeWinPct}% picked to win</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", height: "10px", borderRadius: "6px", overflow: "hidden", marginBottom: "20px", background: "#eee" }}>
                        <div style={{ width: `${awayWinPct}%`, background: awayColor }} />
                        <div style={{ width: `${homeWinPct}%`, background: homeColor }} />
                      </div>
                      {publicPicks.length > 0 && (
                        <div style={{ border: "1px solid #eee", borderRadius: "8px", overflow: "hidden" }}>
                          {(picksExpanded ? publicPicks : publicPicks.slice(0, 5)).map((p, i, arr) => {
                            const side = pickedSideOf(p);
                            const pickedAway = side === "away";
                            const pickedHome = side === "home";
                            const isScored = p.awayScore != null && p.homeScore != null;
                            const pickedLogo = pickedAway ? awaySchool?.Logo1 : pickedHome ? homeSchool?.Logo1 : null;
                            return (
                              <div key={p.id} style={{ padding: "14px", borderBottom: i < arr.length - 1 ? "1px solid #f0f0f0" : "none", display: "flex", alignItems: "center", gap: "14px" }}>
                                {/* Score (or, for a winner-only pick, just the
                                    called team's short name) sits all the way
                                    on the left, in a fixed-width column with
                                    each number in its own fixed-width slot —
                                    keeps the dash (and the digits themselves)
                                    lined up in a straight column from row to
                                    row instead of drifting with digit count.
                                    The logo right next to it already
                                    identifies the picked team, so no
                                    team-name caption is needed underneath
                                    anymore. */}
                                <div style={{ flexShrink: 0, width: isMobile ? "78px" : "92px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  {isScored ? (
                                    <div style={{ display: "flex", alignItems: "baseline" }}>
                                      <span style={{ display: "inline-block", width: "36px", textAlign: "right", fontSize: "30px", fontWeight: 900, color: pickedAway ? awayColor : "#ccc", fontFamily: "'Courier New', monospace", lineHeight: 1 }}>{p.awayScore}</span>
                                      <span style={{ display: "inline-block", width: "18px", textAlign: "center", fontSize: "17px", fontWeight: 700, color: "#ccc" }}>-</span>
                                      <span style={{ display: "inline-block", width: "36px", textAlign: "left", fontSize: "30px", fontWeight: 900, color: pickedHome ? homeColor : "#ccc", fontFamily: "'Courier New', monospace", lineHeight: 1 }}>{p.homeScore}</span>
                                    </div>
                                  ) : (
                                    <span style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.03em", color: pickedAway ? awayColor : pickedHome ? homeColor : "#ccc" }}>
                                      {pickedAway ? (awaySchool?.Short || "Win") : pickedHome ? (homeSchool?.Short || "Win") : "—"}
                                    </span>
                                  )}
                                </div>
                                {pickedLogo ? (
                                  <img src={sanitizeUrl(pickedLogo)} alt={pickedAway ? game.Away : game.Home} title={`Picks ${pickedAway ? game.Away : game.Home}`} style={{ width: "34px", height: "34px", objectFit: "contain", flexShrink: 0 }} />
                                ) : (
                                  <div style={{ width: "34px", height: "34px", flexShrink: 0 }} />
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ display: "flex", alignItems: "center", gap: "5px", fontWeight: 900, fontSize: "13px", color: BLUE }}>
                                    {p.displayName || "Anonymous Fan"}
                                    {verifiedByUid[p.id] && (
                                      <img src={verifiedBadge} alt="Verified" title="Verified" style={{ width: "14px", height: "14px" }} />
                                    )}
                                  </span>
                                  {p.prediction && (
                                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#666", marginTop: "4px", lineHeight: 1.4 }}>{p.prediction}</div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {publicPicks.length > 5 && (
                        <button
                          onClick={() => setPicksExpanded((p) => !p)}
                          style={{
                            display: "block", width: "100%", marginTop: "10px", background: "#fff", color: BLUE,
                            border: `2px solid ${BLUE}`, borderRadius: "8px", padding: "9px", cursor: "pointer",
                            fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em",
                          }}
                        >
                          {picksExpanded ? "Show Less ▲" : `Show All ${publicPicks.length} Picks ▼`}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>


            {/* Footer */}
            <div style={{ marginTop: "32px", paddingTop: "16px", borderTop: "2px solid #eee", display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: "10px" }}>
              <Link to={weekSlateUrl} style={{ background: BLUE, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "6px", padding: "7px 18px", fontWeight: 900, fontSize: "12px", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {weekSlateLabel}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <GameMarginSidebars contentRef={contentRef} isMobile={isMobile} horizontalPadding={20} excludeGameId={game.id} gameWeek={game.Week} weekSlateUrl={weekSlateUrl} />
    </>
  );
}
