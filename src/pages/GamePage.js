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
import { useParams, useNavigate, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc, addDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import LoadingSpinner from "../components/LoadingSpinner";
import GameMarginSidebars from "../components/GameMarginSidebars";
import { useAuth } from "../context/AuthContext";
import verifiedBadge from "../assets/verified.png";
import GameOfWeekBadge from "../assets/weekgame.png";
import FeaturedGameBadge from "../assets/featgame.png";
import confetti from "canvas-confetti";
import { gradeStatLineClass, STAT_LINE_GLOW_STYLE } from "../components/statLineGlow";
import { useCurrentRankMap, ranksForGame, withRank } from "../utils/rankings";

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

const PAGE_STYLE = `
  ${STAT_LINE_GLOW_STYLE}
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

  /* Key Player hover note (and, post-game, Top Performances' stat line —
     same classes, reused as-is) — the name+note stack sits in a fixed-
     height box (sized up front to fit both states) so revealing the note
     never changes the row's own height. Instead, hovering slides the name
     up to the top of that box and fades the note in underneath it, all
     within space that was already reserved — nothing below the row
     shifts, unlike an in-flow max-height reveal (which used to push
     every row down the moment the mouse landed, occasionally shoving
     that row out from under the cursor and flickering the hover state
     on/off in a loop). */
  .wd-keyplayer-name-anim { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); transition: top 0.2s ease, transform 0.2s ease; }
  .wd-perf-row-link:hover .wd-keyplayer-name-anim { top: 0; transform: translateY(0); }
  .wd-keyplayer-note-wrap { position: absolute; left: 0; right: 0; top: 25px; opacity: 0; pointer-events: none; transition: opacity 0.2s ease; }
  .wd-perf-row-link:hover .wd-keyplayer-note-wrap { opacity: 1; }
  /* Mobile has no hover state to reveal a note with, so rows carrying a
     note (see the isMobile-only className above) just render already
     "hovered" — name up top, note visible underneath — instead of hiding
     it behind an interaction touch devices can't perform. */
  .wd-keyplayer-note-forced .wd-keyplayer-name-anim { top: 0; transform: translateY(0); }
  .wd-keyplayer-note-forced .wd-keyplayer-note-wrap { opacity: 1; }

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

// Same fallback NewsArticle.jsx/PlayerProfile.js/TeamPage.js/Navbar.js all
// use for a school with no manually-set Slug field — most FCS schools
// (added ad hoc through AdminPanel.js's Team Branding "+ New Team" form,
// which has no Slug input) never get one. Without this, TeamHeroSide below
// just rendered those teams' names as plain, unclickable text instead of a
// broken link — safer than the bare `.Slug` links elsewhere that collapsed
// to the literal "/team/undefined" for every such team, but still worse
// than actually linking through, now that TeamPage.js itself resolves a
// derived slug like this one back to the right school.
const toTeamSlug = (school) => {
  if (!school) return "";
  return school.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");
};

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
function TeamHeroSide({ school, schoolData, isMobile, dimmed, rank }) {
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
          {/* Rank prefix — its own span (not baked into `school`) so it can
              carry a distinct color from the name itself. */}
          {rank && <span style={{ color: "rgba(255,255,255,0.65)" }}>#{rank} </span>}
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

  const teamSlug = schoolData?.Slug || toTeamSlug(schoolData?.School || school);
  return teamSlug ? (
    <Link to={`/team/${teamSlug}`} style={style}>{inner}</Link>
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
function TeamColumn({ schoolData, keyPlayers, performances, mode, keyPlayerNotes, isMobile }) {
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
            loading="lazy"
            style={{
              position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              width: "70%", maxWidth: "220px", height: "auto", opacity: 0.35, objectFit: "contain", pointerEvents: "none",
            }}
          />
        )
      ) : isFinalMode ? (
        // Player name + stat line — the title lives on the performance's
        // own page; the grade shows up as a pop on the stat line itself
        // (see gradeStatLineClass) once it's revealed, not as text or a
        // row-wide glow. Same fixed-height slide-up/fade-in reveal as the
        // Key Players rows below (see the wd-keyplayer-* comment in
        // PAGE_STYLE): the name sits where it always did, and hovering
        // slides it up to make room for the stat line fading in
        // underneath, all within space already reserved — nothing shifts.
        // Rows with no statLine just render the name with no reveal box at
        // all, same as Key Players' no-note case.
        performances.map((perf, i) => (
          <Link
            key={perf.id}
            to={`/performance/${perf.slug}`}
            className={`wd-perf-row-link${isMobile ? " wd-keyplayer-note-forced" : ""}`}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "12px 16px", textDecoration: "none",
              borderBottom: i < performances.length - 1 ? "1px solid rgba(255,255,255,0.15)" : "none",
              borderLeft: `4px solid ${accent2}`,
            }}
          >
            {perf.statLine ? (
              <div style={{ position: "relative", height: "36px", flex: 1, minWidth: 0 }}>
                <div className="wd-keyplayer-name-anim" style={{ color: "#fff", fontWeight: 900, fontSize: "16px", lineHeight: 1.3, textShadow: "0 1px 3px rgba(0,0,0,0.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {perf.playerName || perf.titleShort}
                </div>
                <div className="wd-keyplayer-note-wrap" style={{ top: "19px" }}>
                  <div className={gradeStatLineClass(perf.grade)} style={{ color: "rgba(255,255,255,0.75)", fontWeight: 700, fontSize: "12px", fontFamily: "'Courier New', monospace", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {perf.statLine}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ minWidth: 0, color: "#fff", fontWeight: 900, fontSize: "16px", lineHeight: 1.3, textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>
                {perf.playerName || perf.titleShort}
              </div>
            )}
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
              className={`wd-perf-row-link${isMobile ? " wd-keyplayer-note-forced" : ""}`}
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
                  <img src={flairInfo.img} alt={p.Flair} loading="lazy" style={{ height: "80%", width: "80%", objectFit: "contain" }} />
                </div>
              ) : fallbackLogo ? (
                <div style={{
                  flexShrink: 0, width: "46px", height: "46px", borderRadius: "10px",
                  background: "#fff", border: `2px solid ${accent2}`,
                  boxShadow: `0 0 12px ${accent2}66`,
                  display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                }}>
                  <img src={fallbackLogo} alt="" loading="lazy" style={{ height: "78%", width: "78%", objectFit: "contain" }} />
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
  const navigate = useNavigate();
  const { user, profile, login } = useAuth();
  const [game, setGame] = useState(null);
  const [awaySchool, setAwaySchool] = useState(null);
  const [homeSchool, setHomeSchool] = useState(null);
  // Current (latest-published) Top 25 — ranksForGame below prefers the
  // frozen HomeRank/AwayRank snapshot (see AdminPanel.js's CFBScheduleSection
  // handleSave) once the game is Final, so this live "current" lookup is
  // really only ever the source of truth pregame/in-progress.
  const currentRankMap = useCurrentRankMap();
  // The broadcasting channel's logo (looked up by Name — see
  // CFBScheduleSection's own "TV Channel" field in AdminPanel.js), shown
  // under the at/vs button in the hero. null until game.Channel resolves
  // and its own fetch (below) finds a match; no channel set at all just
  // means this stays null forever, which the hero already treats as
  // "nothing to show" the same way it does for a missing school logo.
  const [channelLogo, setChannelLogo] = useState(null);
  const [relatedArticles, setRelatedArticles] = useState([]);
  const [keyPlayersAway, setKeyPlayersAway] = useState([]);
  const [keyPlayersHome, setKeyPlayersHome] = useState([]);
  const [performancesAway, setPerformancesAway] = useState([]);
  const [performancesHome, setPerformancesHome] = useState([]);
  const [picks, setPicks] = useState([]);
  const [verifiedByUid, setVerifiedByUid] = useState({});
  // Live current username per uid, fetched in the same users/{uid} batch
  // reads as verifiedByUid above (no extra reads) — picks/comments/replies
  // each store their author's name at write time (displayName/authorName),
  // but that goes stale the moment someone changes their display name
  // afterward. Preferring this live map over the stored field at render
  // time means every past pick/comment always shows whoever's CURRENT
  // name, the same way the evaluations feed (PlayerProfile.js) already
  // works — that one never had this bug because it was never denormalized
  // in the first place.
  const [namesByUid, setNamesByUid] = useState({});
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
  // Comments — open the whole lifetime of the game, positioned above or
  // below Community Predictions depending on isFinal (see gameCommentsCard
  // below), but fetched/reset the same way as everything else on this page
  // so a slug change doesn't leave a previous game's comments briefly
  // visible under the new one. Each entry in gameComments carries its own
  // likedUids/replies (see the comments-fetch effect) rather than those
  // living as separate parallel maps.
  const [gameComments, setGameComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentMessage, setCommentMessage] = useState("");
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  const [likingCommentId, setLikingCommentId] = useState(null);
  const [likingReplyId, setLikingReplyId] = useState(null);
  // Which comment's inline reply box is open — only one at a time, closing
  // whichever was open before, so the thread doesn't accumulate multiple
  // half-written reply boxes scattered through it.
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [replySaving, setReplySaving] = useState(false);
  const [replyMessage, setReplyMessage] = useState("");
  const [deletingReplyId, setDeletingReplyId] = useState(null);
  // Which comments' reply lists are expanded — collapsed by default so a
  // heavily-replied-to comment doesn't push everything below it down the
  // page; a comment with zero replies never shows the toggle at all.
  const [expandedReplies, setExpandedReplies] = useState(new Set());
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
    setNamesByUid({});
    setHypeUids(new Set());
    setPicksExpanded(false);
    setGameComments([]);
    setCommentsLoading(true);
    setCommentText("");
    setCommentMessage("");
    setReplyingToId(null);
    setReplyText("");
    setReplyMessage("");
    setExpandedReplies(new Set());
    setNotFound(false);
    setLoading(true);

    const fetch = async () => {
      // Declared outside the try block (not `const g` inside it) so the
      // separate comments fetch below — deliberately outside that same
      // try/catch, see its own comment — can still reach it.
      let g = null;
      try {
        const snap = await getDocs(query(collection(db, "schedule26"), where("Slug", "==", slug)));
        if (snap.empty) {
          // Every schedule26 doc's Slug now ends in "-{year}" (see
          // gameSlugFor in AdminPanel.js — every game was backfilled, so
          // this holds for the whole collection, not just new ones). Old
          // links/search results out there still point at the pre-year
          // slug, which no longer exact-matches. Before giving up, try it
          // as a prefix: if the year is genuinely the only thing missing,
          // "{slug}-{year}" is a real Slug, and a range query for
          // Slug >= "{slug}-" and < "{slug}-" (the standard Firestore
          // "starts with" trick) catches it without needing a composite
          // index, since every condition is on the same field. Redirects
          // (replace, not push) to the real slug instead of just rendering
          // the game under the old URL, so old links/search results
          // actually get pointed at the canonical one over time.
          const prefixSnap = await getDocs(query(
            collection(db, "schedule26"),
            where("Slug", ">=", slug + "-"),
            where("Slug", "<", slug + "-"),
            orderBy("Slug"),
          ));
          if (!prefixSnap.empty) {
            // An annual rivalry played on the same month/day every year
            // shares this same prefix across seasons — Slug values only
            // differ by the trailing year token, so a plain string sort
            // doubles as a numeric one; prefer the most recent.
            const candidates = prefixSnap.docs.map((d) => d.data().Slug).filter(Boolean).sort().reverse();
            if (candidates[0]) {
              navigate(`/game/${candidates[0]}`, { replace: true });
              return;
            }
          }
          setNotFound(true);
          return;
        }
        g = { id: snap.docs[0].id, ...snap.docs[0].data() };
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

        // Batch-fetch each picker's users/{uid} doc for the "verified" badge
        // (same pattern PlayerProfile.js uses for community evaluations)
        // and their live current username — picks store a displayName
        // snapshot at save time (see handleSavePick), but a picker who
        // renames themselves afterward should still show their new name
        // here, not whatever it was when they picked. Both maps merged in
        // (not replaced) since the separate comments fetch below populates
        // the same two maps for comment/reply authors — whichever of the
        // two finishes last shouldn't wipe out the other's entries.
        const pickUids = [...new Set(loadedPicks.map((p) => p.id))];
        if (pickUids.length) {
          const userSnaps = await Promise.all(pickUids.map((uid) => getDoc(doc(db, "users", uid))));
          const vMap = {};
          const nMap = {};
          userSnaps.forEach((s, idx) => {
            vMap[pickUids[idx]] = !!(s.exists() && s.data().verified);
            const uname = s.exists() ? s.data().username?.trim() : "";
            if (uname) nMap[pickUids[idx]] = uname;
          });
          setVerifiedByUid((prev) => ({ ...prev, ...vMap }));
          setNamesByUid((prev) => ({ ...prev, ...nMap }));
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

      // Fetched separately from everything above, on purpose: comments are
      // open the whole lifetime of the game (pregame, live, and after —
      // see gameCommentsCard below, which just moves position relative to
      // Community Predictions depending on isFinal), but its Firestore
      // rule can lag behind a deploy independently of every other
      // collection this page depends on. Isolating it means a permission
      // error here shows up as an empty comments list, never as "Game not
      // found" for the whole page.
      if (g) {
        try {
          const commentsSnap = await getDocs(query(collection(db, "schedule26", g.id, "comments"), orderBy("createdAt", "desc")));
          const baseComments = commentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

          // Likes and replies both live one level deeper per comment (see
          // firestore.rules) — fetched eagerly for every comment here
          // (rather than lazily per-comment on demand) so a reply count is
          // known up front for the collapsed "N replies" toggle without a
          // second round trip once someone clicks it. Comment volume on a
          // single game is small enough that this stays cheap.
          const [likesSnaps, repliesSnaps] = await Promise.all([
            Promise.all(baseComments.map((c) => getDocs(collection(db, "schedule26", g.id, "comments", c.id, "likes")))),
            Promise.all(baseComments.map((c) => getDocs(query(collection(db, "schedule26", g.id, "comments", c.id, "replies"), orderBy("createdAt", "asc"))))),
          ]);

          // Replies are likeable too — a second wave, once reply ids (and
          // which comment each belongs to) are actually known from the
          // fetch just above.
          const baseRepliesPerComment = repliesSnaps.map((snap, i) =>
            snap.docs.map((d) => ({ id: d.id, commentId: baseComments[i].id, ...d.data() }))
          );
          const allReplies = baseRepliesPerComment.flat();
          const replyLikesSnaps = await Promise.all(
            allReplies.map((r) => getDocs(collection(db, "schedule26", g.id, "comments", r.commentId, "replies", r.id, "likes")))
          );
          const replyLikedUidsById = new Map(
            allReplies.map((r, i) => [r.id, new Set(replyLikesSnaps[i].docs.map((d) => d.id))])
          );

          // likedUids (not a pre-computed likedByMe boolean) so "did I like
          // this" is derived at render time from the current `user` — same
          // reasoning as hypeUids/iHyped above: reacts correctly to a
          // sign-in/out that happens without the slug (and so this fetch)
          // changing, instead of freezing whatever `user` was in scope
          // when this effect last ran. Same for replies' own likedUids.
          const enriched = baseComments.map((c, i) => ({
            ...c,
            likedUids: new Set(likesSnaps[i].docs.map((d) => d.id)),
            replies: baseRepliesPerComment[i].map((r) => ({ ...r, likedUids: replyLikedUidsById.get(r.id) || new Set() })),
          }));
          setGameComments(enriched);

          // Verified badges + live current usernames for comment + reply
          // authors — merged into the same verifiedByUid/namesByUid maps
          // the picks fetch above uses, not second parallel ones. Same
          // staleness reasoning as picks: authorName is a snapshot taken
          // when the comment/reply was posted (see handlePostComment/
          // handlePostReply), and namesByUid is what keeps it from going
          // stale after a display-name change.
          const commentUids = [...new Set([
            ...enriched.map((c) => c.uid),
            ...enriched.flatMap((c) => c.replies.map((r) => r.uid)),
          ].filter(Boolean))];
          if (commentUids.length) {
            const userSnaps = await Promise.all(commentUids.map((uid) => getDoc(doc(db, "users", uid))));
            const vMap = {};
            const nMap = {};
            userSnaps.forEach((s, idx) => {
              vMap[commentUids[idx]] = !!(s.exists() && s.data().verified);
              const uname = s.exists() ? s.data().username?.trim() : "";
              if (uname) nMap[commentUids[idx]] = uname;
            });
            setVerifiedByUid((prev) => ({ ...prev, ...vMap }));
            setNamesByUid((prev) => ({ ...prev, ...nMap }));
          }
        } catch (e) {
          console.error("Game comments fetch error:", e);
          setGameComments([]);
        } finally {
          setCommentsLoading(false);
        }
      } else {
        setCommentsLoading(false);
      }
    };
    fetch();
  }, [slug, navigate]);

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

  // Articles tagged to this game — same "separate, independent lookup"
  // shape as channelLogo above, keyed on game.id (ArticlesManager.js's own
  // "+ Game" picker stores the real schedule26 doc id in an article's
  // gameIds array, the same way playerIds/schools already work for
  // PlayerProfile.js/TeamPage.js).
  useEffect(() => {
    if (!game?.id) { setRelatedArticles([]); return; }
    let cancelled = false;
    const loadArticles = async () => {
      try {
        const snap = await getDocs(query(
          collection(db, "articles"),
          where("status", "==", "published"),
          where("gameIds", "array-contains", game.id),
          orderBy("publishedAt", "desc"),
          limit(6),
        ));
        if (cancelled) return;
        setRelatedArticles(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error("Related articles fetch error:", e);
        if (!cancelled) setRelatedArticles([]);
      }
    };
    loadArticles();
    return () => { cancelled = true; };
  }, [game?.id]);

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

  // ── Simple client-side profanity gate — same word list/approach
  // PlayerProfile.js and UserProfile.js already use for public text
  // (public evaluations, issue reports); duplicated here rather than
  // imported cross-page, matching this file's own convention for small
  // shared constants (see FLAIR_CONFIG above). ──
  const bannedWords = ["faggot", "nigger", "monkey", "nigga", "fuck"];
  const containsProfanity = (text) => bannedWords.some((w) => text.toLowerCase().includes(w));

  const handlePostComment = async () => {
    if (!user) { login(); return; }
    const text = commentText.trim();
    if (!text) { setCommentMessage("Write something first."); return; }
    if (containsProfanity(text)) { setCommentMessage("Comment contains inappropriate language."); return; }
    setCommentSaving(true);
    setCommentMessage("");
    try {
      const payload = {
        uid: user.uid,
        authorName: profile?.username?.trim() || "Anonymous Fan",
        text,
        createdAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, "schedule26", game.id, "comments"), payload);
      // Optimistic local prepend — serverTimestamp() doesn't resolve to a
      // real value until Firestore round-trips it back, so a plain Date
      // stands in until then (same trick PlayerProfile.js's archive flow
      // uses: something with a .toDate() shape so render code never has to
      // special-case "just posted" vs "loaded from Firestore"). Brand new,
      // so no likes and no replies yet either.
      const now = new Date();
      setGameComments((prev) => [{ id: ref.id, ...payload, createdAt: { toDate: () => now }, likedUids: new Set(), replies: [] }, ...prev]);
      setCommentText("");
    } catch (e) {
      console.error("Post comment error:", e);
      setCommentMessage("Failed to post — try again.");
    } finally {
      setCommentSaving(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!game || !window.confirm("Delete this comment? Its likes and replies go with it.")) return;
    setDeletingCommentId(commentId);
    try {
      const [likesSnap, repliesSnap] = await Promise.all([
        getDocs(collection(db, "schedule26", game.id, "comments", commentId, "likes")),
        getDocs(collection(db, "schedule26", game.id, "comments", commentId, "replies")),
      ]);
      // Each reply can have its own likes too — one more level to clear
      // before the replies themselves.
      const replyLikesSnaps = await Promise.all(
        repliesSnap.docs.map((d) => getDocs(collection(db, "schedule26", game.id, "comments", commentId, "replies", d.id, "likes")))
      );
      // Best-effort, not required to succeed: a non-admin author can only
      // delete their own like/reply docs (see firestore.rules), so someone
      // else's likes/replies on a comment they're deleting are left behind
      // as harmless orphans rather than blocking the comment delete below.
      // Promise.allSettled (not Promise.all) so those denials don't reject
      // the whole cleanup. Admins clear everything, since isAdmin() passes
      // every one of those checks too.
      await Promise.allSettled([
        ...likesSnap.docs.map((d) => deleteDoc(d.ref)),
        ...replyLikesSnaps.flatMap((snap) => snap.docs.map((d) => deleteDoc(d.ref))),
        ...repliesSnap.docs.map((d) => deleteDoc(d.ref)),
      ]);
      await deleteDoc(doc(db, "schedule26", game.id, "comments", commentId));
      setGameComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (e) {
      console.error("Delete comment error:", e);
      alert("Failed to delete — check console.");
    } finally {
      setDeletingCommentId(null);
    }
  };

  const handleToggleCommentLike = async (comment) => {
    if (!user) { login(); return; }
    if (!game) return;
    const alreadyLiked = comment.likedUids.has(user.uid);
    setLikingCommentId(comment.id);
    const likeRef = doc(db, "schedule26", game.id, "comments", comment.id, "likes", user.uid);
    try {
      if (alreadyLiked) {
        await deleteDoc(likeRef);
      } else {
        await setDoc(likeRef, { uid: user.uid, createdAt: serverTimestamp() });
      }
      setGameComments((prev) => prev.map((c) => {
        if (c.id !== comment.id) return c;
        const nextLiked = new Set(c.likedUids);
        if (alreadyLiked) nextLiked.delete(user.uid); else nextLiked.add(user.uid);
        return { ...c, likedUids: nextLiked };
      }));
    } catch (e) {
      console.error("Toggle comment like error:", e);
    } finally {
      setLikingCommentId(null);
    }
  };

  const handlePostReply = async (commentId) => {
    if (!user) { login(); return; }
    if (!game) return;
    const text = replyText.trim();
    if (!text) { setReplyMessage("Write something first."); return; }
    if (containsProfanity(text)) { setReplyMessage("Reply contains inappropriate language."); return; }
    setReplySaving(true);
    setReplyMessage("");
    try {
      const payload = {
        uid: user.uid,
        authorName: profile?.username?.trim() || "Anonymous Fan",
        text,
        createdAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, "schedule26", game.id, "comments", commentId, "replies"), payload);
      const now = new Date();
      const newReply = { id: ref.id, commentId, ...payload, createdAt: { toDate: () => now }, likedUids: new Set() };
      setGameComments((prev) => prev.map((c) => c.id === commentId ? { ...c, replies: [...c.replies, newReply] } : c));
      // Opening the reply box already implied interest in this thread —
      // auto-expanding it means the reply someone just posted doesn't
      // vanish behind a still-collapsed "N replies" toggle.
      setExpandedReplies((prev) => new Set(prev).add(commentId));
      setReplyText("");
      setReplyingToId(null);
    } catch (e) {
      console.error("Post reply error:", e);
      setReplyMessage("Failed to post — try again.");
    } finally {
      setReplySaving(false);
    }
  };

  const handleDeleteReply = async (commentId, replyId) => {
    if (!game || !window.confirm("Delete this reply?")) return;
    setDeletingReplyId(replyId);
    try {
      // Best-effort cleanup of the reply's own likes first — same
      // reasoning as handleDeleteComment above (a non-admin author can
      // only delete their own like docs; whatever's left behind is a
      // harmless orphan once the reply itself is gone).
      const replyLikesSnap = await getDocs(collection(db, "schedule26", game.id, "comments", commentId, "replies", replyId, "likes"));
      await Promise.allSettled(replyLikesSnap.docs.map((d) => deleteDoc(d.ref)));
      await deleteDoc(doc(db, "schedule26", game.id, "comments", commentId, "replies", replyId));
      setGameComments((prev) => prev.map((c) => c.id === commentId ? { ...c, replies: c.replies.filter((r) => r.id !== replyId) } : c));
    } catch (e) {
      console.error("Delete reply error:", e);
      alert("Failed to delete — check console.");
    } finally {
      setDeletingReplyId(null);
    }
  };

  const handleToggleReplyLike = async (commentId, reply) => {
    if (!user) { login(); return; }
    if (!game) return;
    const alreadyLiked = reply.likedUids.has(user.uid);
    setLikingReplyId(reply.id);
    const likeRef = doc(db, "schedule26", game.id, "comments", commentId, "replies", reply.id, "likes", user.uid);
    try {
      if (alreadyLiked) {
        await deleteDoc(likeRef);
      } else {
        await setDoc(likeRef, { uid: user.uid, createdAt: serverTimestamp() });
      }
      setGameComments((prev) => prev.map((c) => {
        if (c.id !== commentId) return c;
        return {
          ...c,
          replies: c.replies.map((r) => {
            if (r.id !== reply.id) return r;
            const nextLiked = new Set(r.likedUids);
            if (alreadyLiked) nextLiked.delete(user.uid); else nextLiked.add(user.uid);
            return { ...r, likedUids: nextLiked };
          }),
        };
      }));
    } catch (e) {
      console.error("Toggle reply like error:", e);
    } finally {
      setLikingReplyId(null);
    }
  };

  const toggleReplyBox = (commentId) => {
    setReplyMessage("");
    setReplyText("");
    setReplyingToId((prev) => (prev === commentId ? null : commentId));
  };

  const toggleRepliesExpanded = (commentId) => {
    setExpandedReplies((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId); else next.add(commentId);
      return next;
    });
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
  const { homeRank, awayRank } = ranksForGame(game, currentRankMap);
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
  // The one visible H1 for this page (see the masthead below) — kept as its
  // own constant since it's also reused for structured data's own "name".
  const h1Text = `${game.Away} vs ${game.Home} Football${dateStr ? ` — ${dateStr}` : ""}`;
  // A long matchup name + full date ("New Mexico State vs Florida State
  // Football — Saturday, August 29, 2026") at a fixed font size was
  // wrapping onto a second line in the masthead's kicker slot, which grew
  // the whole masthead bar taller to fit it — the H1 is meant to be a
  // quiet accent above the real headline (the big date below it), not
  // something that pushes layout around. Scaling the size down as the
  // string gets longer keeps it a single line at every length instead;
  // whiteSpace:nowrap + ellipsis on the element itself (see the masthead
  // below) is the hard backstop for whatever's still too long even at the
  // smallest tier.
  const h1FontSize = isMobile
    ? (h1Text.length > 46 ? "7px" : h1Text.length > 34 ? "8px" : "9px")
    : (h1Text.length > 60 ? "8px" : h1Text.length > 46 ? "9px" : "10px");
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
  // Final games lead with the actual result (real game.AwayScore/HomeScore,
  // not the community's pre-game projection — that framing goes stale the
  // moment the game ends) instead of reusing the same "the community
  // projects..." copy regardless of whether the game has even been played
  // yet, which is what this used to do.
  const seoDescription = isFinal
    ? `Final: ${game.Away} ${game.AwayScore} – ${game.Home} ${game.HomeScore}${dateStr ? ` on ${dateStr}` : ""}. See top performances and how the We-Draft community predicted this game.`
    : `${seoDateTime ? `${seoDateTime}. ` : ""}${seoPredictionSummary}`;

  // Structured data — SportsEvent, populated only from fields that actually
  // exist on the game doc (checked AdminPanel.js's CFB Schedule editor:
  // there's no venue/stadium/attendance field in the data model at all, so
  // "location" is omitted rather than guessed). startDate prefers the real
  // kickoff instant (kickoffAtMs, date+ET time combined) when a Time is
  // set, falling back to a date-only value when it isn't — never invents a
  // time that wasn't actually entered.
  const gameStartDateIso = kickoffAtMs != null
    ? new Date(kickoffAtMs).toISOString()
    : (gameDateMs ? new Date(gameDateMs).toISOString().slice(0, 10) : null);
  const gameStructuredData = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    "name": h1Text,
    "url": canonicalUrl,
    "sport": "American Football",
    ...(gameStartDateIso ? { "startDate": gameStartDateIso } : {}),
    "homeTeam": { "@type": "SportsTeam", "name": game.Home },
    "awayTeam": { "@type": "SportsTeam", "name": game.Away },
    "description": seoDescription,
  };

  // ── Game Comments card — built once here so it can be dropped in at
  // either of two positions below (isFinal ? above Community Predictions
  // : below it) without duplicating the markup. Open the whole lifetime of
  // the game, not just once final — pregame/live it just renders further
  // down the page. ──
  const gameCommentsCard = (
    <div style={{ marginBottom: "28px" }}>
      <div style={{ border: `2px solid ${BLUE}`, borderRadius: "12px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, color: GOLD, fontWeight: 900, fontSize: isMobile ? "15px" : "18px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            💬 Game Comments
          </h2>
          <div style={{ color: "#fff", background: "rgba(255,255,255,0.18)", fontSize: isMobile ? "13px" : "15px", fontWeight: 900, padding: "5px 14px", borderRadius: "20px" }}>
            {gameComments.length} comment{gameComments.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div style={{ height: "3px", background: GOLD }} />
        <div style={{ padding: isMobile ? "16px" : "20px 24px" }}>
          {user ? (
            <div style={{ marginBottom: "18px" }}>
              <textarea
                value={commentText}
                onChange={(e) => { setCommentText(e.target.value); setCommentMessage(""); }}
                placeholder="Share your take on this game..."
                rows={3}
                style={{ width: "100%", border: "2px solid #ddd", borderRadius: "8px", padding: "10px 12px", fontSize: "14px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", outline: "none" }}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: "8px", gap: "12px", flexWrap: "wrap" }}>
                {commentMessage && (
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#c0392b" }}>{commentMessage}</div>
                )}
                <button
                  onClick={handlePostComment}
                  disabled={commentSaving || !commentText.trim()}
                  style={{
                    background: BLUE, color: "#fff", border: `2px solid ${GOLD}`,
                    borderRadius: "8px", padding: "9px 20px", fontWeight: 900, fontSize: "13px",
                    textTransform: "uppercase", letterSpacing: "0.04em",
                    cursor: commentSaving || !commentText.trim() ? "default" : "pointer",
                    opacity: commentSaving || !commentText.trim() ? 0.6 : 1,
                  }}
                >
                  {commentSaving ? "Posting..." : "Post Comment"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={login}
              style={{
                width: "100%", marginBottom: "18px", background: "#fff", color: BLUE, border: `2px solid ${BLUE}`,
                borderRadius: "8px", padding: "10px", fontWeight: 900, fontSize: "13px",
                textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
              }}
            >
              Sign In To Comment
            </button>
          )}

          {commentsLoading ? (
            <LoadingSpinner label="Loading comments" size={24} minHeight="60px" />
          ) : gameComments.length === 0 ? (
            <div style={{ textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>
              No comments yet — be the first to weigh in.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {gameComments.map((c, i) => {
                const canDelete = user && (user.uid === c.uid || profile?.role === "admin");
                const commentMs = toMs(c.createdAt);
                const iLiked = user ? c.likedUids.has(user.uid) : false;
                const isReplying = replyingToId === c.id;
                const repliesShown = expandedReplies.has(c.id);
                // Live current name if we have it, falling back to the
                // snapshot stored on the comment itself (see namesByUid
                // above) — never a stale name once the author's real one
                // is known.
                const commentAuthorName = namesByUid[c.uid] || c.authorName || "Anonymous Fan";
                return (
                  <div key={c.id} style={{ borderBottom: i < gameComments.length - 1 ? "1px solid #eee" : "none", paddingBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                        <span style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>{commentAuthorName}</span>
                        {verifiedByUid[c.uid] && (
                          <img src={verifiedBadge} alt="Verified" title="Verified" loading="lazy" style={{ width: "14px", height: "14px" }} />
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#aaa" }}>
                          {commentMs > 0 ? new Date(commentMs).toLocaleString() : ""}
                        </div>
                        {canDelete && (
                          <button
                            onClick={() => handleDeleteComment(c.id)}
                            disabled={deletingCommentId === c.id}
                            style={{ background: "none", border: "none", color: "#c0392b", cursor: deletingCommentId === c.id ? "default" : "pointer", fontSize: "11px", fontWeight: 800, textDecoration: "underline", padding: 0 }}
                          >
                            {deletingCommentId === c.id ? "…" : "Delete"}
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: "14px", color: "#333", lineHeight: 1.5, marginTop: "5px", whiteSpace: "pre-wrap" }}>
                      {c.text}
                    </div>

                    {/* Like / Reply / replies-toggle row — every action a
                        comment supports lives in one place, in that order,
                        so it reads left-to-right the same way on every
                        comment instead of moving around. */}
                    <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "8px" }}>
                      <button
                        onClick={() => handleToggleCommentLike(c)}
                        disabled={likingCommentId === c.id}
                        style={{
                          display: "flex", alignItems: "center", gap: "5px",
                          background: "none", border: "none", padding: 0,
                          color: iLiked ? GOLD : "#999", fontWeight: 800, fontSize: "12px",
                          cursor: likingCommentId === c.id ? "default" : "pointer",
                        }}
                      >
                        <span>👍</span>
                        {c.likedUids.size > 0 ? c.likedUids.size : "Like"}
                      </button>
                      <button
                        onClick={() => toggleReplyBox(c.id)}
                        style={{ background: "none", border: "none", padding: 0, color: "#999", fontWeight: 800, fontSize: "12px", cursor: "pointer" }}
                      >
                        {isReplying ? "Cancel" : "Reply"}
                      </button>
                      {c.replies.length > 0 && (
                        <button
                          onClick={() => toggleRepliesExpanded(c.id)}
                          style={{ background: "none", border: "none", padding: 0, color: BLUE, fontWeight: 800, fontSize: "12px", cursor: "pointer" }}
                        >
                          {repliesShown ? "▲ Hide" : "▼ View"} {c.replies.length} repl{c.replies.length !== 1 ? "ies" : "y"}
                        </button>
                      )}
                    </div>

                    {/* Inline reply box — only one open across the whole
                        thread at a time (toggleReplyBox closes any other
                        that was open), directly under the comment it's
                        replying to so there's no ambiguity about which
                        comment a reply targets. */}
                    {isReplying && (
                      <div style={{ marginTop: "10px", marginLeft: isMobile ? "0" : "24px" }}>
                        {user ? (
                          <>
                            <textarea
                              value={replyText}
                              onChange={(e) => { setReplyText(e.target.value); setReplyMessage(""); }}
                              placeholder={`Reply to ${commentAuthorName}...`}
                              rows={2}
                              autoFocus
                              style={{ width: "100%", border: "2px solid #ddd", borderRadius: "8px", padding: "8px 10px", fontSize: "13px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", outline: "none" }}
                            />
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: "6px", gap: "10px", flexWrap: "wrap" }}>
                              {replyMessage && (
                                <div style={{ fontSize: "11px", fontWeight: 700, color: "#c0392b" }}>{replyMessage}</div>
                              )}
                              <button
                                onClick={() => handlePostReply(c.id)}
                                disabled={replySaving || !replyText.trim()}
                                style={{
                                  background: BLUE, color: "#fff", border: `2px solid ${GOLD}`,
                                  borderRadius: "6px", padding: "6px 16px", fontWeight: 900, fontSize: "11px",
                                  textTransform: "uppercase", letterSpacing: "0.04em",
                                  cursor: replySaving || !replyText.trim() ? "default" : "pointer",
                                  opacity: replySaving || !replyText.trim() ? 0.6 : 1,
                                }}
                              >
                                {replySaving ? "Posting..." : "Post Reply"}
                              </button>
                            </div>
                          </>
                        ) : (
                          <button
                            onClick={login}
                            style={{
                              background: "#fff", color: BLUE, border: `2px solid ${BLUE}`,
                              borderRadius: "6px", padding: "7px 14px", fontWeight: 900, fontSize: "11px",
                              textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
                            }}
                          >
                            Sign In To Reply
                          </button>
                        )}
                      </div>
                    )}

                    {/* Replies — indented under their parent, single level
                        only (a reply can't itself be replied to), each a
                        lighter-weight echo of a top-level comment's own
                        author/verified/timestamp/delete layout. */}
                    {repliesShown && c.replies.length > 0 && (
                      <div style={{ marginTop: "10px", marginLeft: isMobile ? "12px" : "24px", display: "flex", flexDirection: "column", gap: "10px", borderLeft: "2px solid #eee", paddingLeft: "12px" }}>
                        {c.replies.map((r) => {
                          const canDeleteReply = user && (user.uid === r.uid || profile?.role === "admin");
                          const replyMs = toMs(r.createdAt);
                          const iLikedReply = user ? r.likedUids.has(user.uid) : false;
                          const replyAuthorName = namesByUid[r.uid] || r.authorName || "Anonymous Fan";
                          return (
                            <div key={r.id}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                  <span style={{ fontWeight: 900, fontSize: "12px", color: BLUE }}>{replyAuthorName}</span>
                                  {verifiedByUid[r.uid] && (
                                    <img src={verifiedBadge} alt="Verified" title="Verified" loading="lazy" style={{ width: "12px", height: "12px" }} />
                                  )}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <div style={{ fontSize: "10px", fontWeight: 700, color: "#aaa" }}>
                                    {replyMs > 0 ? new Date(replyMs).toLocaleString() : ""}
                                  </div>
                                  {canDeleteReply && (
                                    <button
                                      onClick={() => handleDeleteReply(c.id, r.id)}
                                      disabled={deletingReplyId === r.id}
                                      style={{ background: "none", border: "none", color: "#c0392b", cursor: deletingReplyId === r.id ? "default" : "pointer", fontSize: "10px", fontWeight: 800, textDecoration: "underline", padding: 0 }}
                                    >
                                      {deletingReplyId === r.id ? "…" : "Delete"}
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div style={{ fontSize: "13px", color: "#333", lineHeight: 1.45, marginTop: "3px", whiteSpace: "pre-wrap" }}>
                                {r.text}
                              </div>
                              <button
                                onClick={() => handleToggleReplyLike(c.id, r)}
                                disabled={likingReplyId === r.id}
                                style={{
                                  display: "flex", alignItems: "center", gap: "5px", marginTop: "5px",
                                  background: "none", border: "none", padding: 0,
                                  color: iLikedReply ? GOLD : "#999", fontWeight: 800, fontSize: "11px",
                                  cursor: likingReplyId === r.id ? "default" : "pointer",
                                }}
                              >
                                <span>👍</span>
                                {r.likedUids.size > 0 ? r.likedUids.size : "Like"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <style>{PAGE_STYLE}</style>
      <Helmet>
        <title>{seoTitle}</title>
        <meta name="description" content={seoDescription} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={seoTitle} />
        <meta property="og:description" content={seoDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="We-Draft" />
        <script type="application/ld+json">{JSON.stringify(gameStructuredData)}</script>
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
          <div style={{ background: BLUE, padding: isMobile ? "9px 14px" : "11px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
            <div>
              {/* The page's one H1 — a small uppercase kicker line above the
                  big date, rather than a separate visual banner, so it fits
                  the existing masthead instead of adding a new competing
                  block. States the same matchup+date the surrounding hero
                  already communicates visually (logos/names/date), which is
                  fine here — search engines expect an H1 to name the page's
                  subject even when other elements already convey it. */}
              <h1 style={{
                margin: 0, color: "rgba(255,255,255,0.6)", fontWeight: 800, fontSize: h1FontSize,
                textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.1,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                maxWidth: isMobile ? "220px" : "480px",
              }}>
                {h1Text}
              </h1>
              {dateStr && (
                <div style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? "15px" : "19px", lineHeight: 1.15, marginTop: "1px" }}>{dateStr}</div>
              )}
              {timeStr && (
                <div style={{ color: GOLD, fontWeight: 800, fontSize: isMobile ? "12px" : "15px", lineHeight: 1.15, marginTop: "1px" }}>{timeStr}</div>
              )}
            </div>
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
              <div style={{ position: "relative", zIndex: 1, textAlign: "center", marginBottom: isMobile ? "22px" : "34px" }}>
                {/* Own badge graphic (src/assets/weekgame.png, featgame.png,
                    both a 1780x659 rounded-rectangle badge) instead of a
                    text pill — already has its own background/border baked
                    in, so the box-shadow glow below hugs the image's own
                    corners directly rather than needing a separate
                    background/border here. Sized to actually read as the
                    hero's own headline element, not a small tag bolted on
                    top of it. */}
                <img
                  src={game.GameOfWeek ? GameOfWeekBadge : FeaturedGameBadge}
                  alt={game.GameOfWeek ? "We-Draft.com's Game of the Week" : "We-Draft.com's Featured Game"}
                  className={game.GameOfWeek ? "wd-gotw-badge" : "wd-featured-badge"}
                  style={{
                    display: "inline-block",
                    height: isMobile ? "84px" : "140px",
                    width: "auto",
                    maxWidth: "90%",
                    objectFit: "contain",
                    borderRadius: "14px",
                  }}
                />
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
              <TeamHeroSide key={`${game.id}-away`} school={game.Away} schoolData={awaySchool} isMobile={isMobile} dimmed={isFinal && homeWon} rank={awayRank} />

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
                    loading="lazy"
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
                        {/* >= on both sides (not > on one) so a tie lights up
                            both numbers white instead of only the away one. */}
                        <span style={{ fontSize: isMobile ? "20px" : "26px", fontWeight: 900, color: awayWinPct >= homeWinPct ? "#fff" : "rgba(255,255,255,0.5)", lineHeight: 1 }}>{avgAwayScore}</span>
                        <span style={{ fontSize: "13px", fontWeight: 900, color: "rgba(255,255,255,0.4)" }}>–</span>
                        <span style={{ fontSize: isMobile ? "20px" : "26px", fontWeight: 900, color: homeWinPct >= awayWinPct ? "#fff" : "rgba(255,255,255,0.5)", lineHeight: 1 }}>{avgHomeScore}</span>
                      </div>
                    )}
                    <div style={{ display: "flex", height: "7px", borderRadius: "5px", overflow: "hidden", background: "rgba(255,255,255,0.15)" }}>
                      <div style={{ width: `${awayWinPct}%`, background: awayColor }} />
                      <div style={{ width: `${homeWinPct}%`, background: homeColor }} />
                    </div>
                  </div>
                )}
              </div>

              <TeamHeroSide key={`${game.id}-home`} school={game.Home} schoolData={homeSchool} isMobile={isMobile} dimmed={isFinal && awayWon} rank={homeRank} />
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
                  <h2 style={{ margin: 0, color: "#fff", fontSize: isMobile ? "11px" : "13px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", textShadow: "0 2px 5px rgba(0,0,0,0.4)" }}>
                    {isFinal
                      ? `${withRank(game.Away, awayRank)} vs ${withRank(game.Home, homeRank)} Game Recap`
                      : `${withRank(game.Away, awayRank)} vs ${withRank(game.Home, homeRank)} Preview`}
                  </h2>
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
                  <h2 style={{ margin: 0, color: "#fff", fontSize: isMobile ? "13px" : "15px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", textShadow: "0 2px 6px rgba(0,0,0,0.5)" }}>
                    {isFinal ? `${withRank(game.Away, awayRank)} vs ${withRank(game.Home, homeRank)} Top Performances` : "Key Players to Watch"}
                  </h2>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? "16px" : "24px" }}>
                  <TeamColumn
                    schoolData={awaySchool}
                    keyPlayers={keyPlayersAway}
                    performances={performancesAway}
                    mode={isFinal ? "final" : "pregame"}
                    keyPlayerNotes={game.KeyPlayerNotes}
                    isMobile={isMobile}
                  />
                  <TeamColumn
                    schoolData={homeSchool}
                    keyPlayers={keyPlayersHome}
                    performances={performancesHome}
                    mode={isFinal ? "final" : "pregame"}
                    keyPlayerNotes={game.KeyPlayerNotes}
                    isMobile={isMobile}
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
                  <h2 style={{ margin: 0, color: GOLD, fontWeight: 900, fontSize: "13px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    🔮 {withRank(game.Away, awayRank)} vs {withRank(game.Home, homeRank)} Predictions
                  </h2>
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
                      {/* kickoffPassed (game underway, not yet Final) means
                          picksOpenAtMs is already in the past — showing "Pick
                          this game starting {that date}" would read as
                          nonsense mid-game, so that message is only for the
                          other picksLocked case (this week's picks haven't
                          opened yet). */}
                      {kickoffPassed
                        ? "Predictions are not available during the game."
                        : `Pick this game starting ${new Date(picksOpenAtMs).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}.`}
                      {/* Locked doesn't mean gone — same "Your pick" readout
                          the isFinal branch above shows, so a prediction made
                          before kickoff is still visible (just no longer
                          editable) while the game's actually being played. */}
                      {kickoffPassed && myPick && (
                        <div style={{ marginTop: "10px", fontStyle: "normal", fontWeight: 800, color: "#fff" }}>
                          {myPick.awayScore != null && myPick.homeScore != null
                            ? `Your pick: ${game.Away} ${myPick.awayScore} – ${game.Home} ${myPick.homeScore}`
                            : `Your pick: ${pickedSideOf(myPick) === "away" ? game.Away : pickedSideOf(myPick) === "home" ? game.Home : "—"} to win`}
                        </div>
                      )}
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
                              <img src={sanitizeUrl(awaySchool.LogoDark || awaySchool.Logo1)} alt={game.Away} loading="lazy" style={{ width: "52px", height: "52px", objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.5))" }} />
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
                              <img src={sanitizeUrl(homeSchool.LogoDark || homeSchool.Logo1)} alt={game.Home} loading="lazy" style={{ width: "52px", height: "52px", objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.5))" }} />
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
                                <img src={sanitizeUrl(schoolData.LogoDark || schoolData.Logo1)} alt={name} loading="lazy" style={{ width: "48px", height: "48px", objectFit: "contain" }} />
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

            {/* Game Comments — open the whole lifetime of the game, but
                repositions around Community Predictions depending on
                isFinal (see gameCommentsCard above): once the game's over,
                the discussion is the more relevant of the two and leads;
                pregame/live, predictions are still the main event and
                comments trail below them. */}
            {isFinal && gameCommentsCard}

            {/* Community Picks — aggregate score/win-split stats across
                everyone's picks (private ones included in the numbers),
                plus a feed of the public ones' names and notes. */}
            <div ref={communityPicksRef} style={{ marginBottom: "28px" }}>
              <div style={{ border: `2px solid ${BLUE}`, borderRadius: "12px", overflow: "hidden" }}>
                <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h2 style={{ margin: 0, color: GOLD, fontWeight: 900, fontSize: isMobile ? "15px" : "18px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    📊 Community Predictions
                  </h2>
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
                            <img src={sanitizeUrl(awaySchool.Logo1)} alt="" loading="lazy" style={{ width: "34px", height: "34px", objectFit: "contain", marginBottom: "6px" }} />
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
                            <img src={sanitizeUrl(homeSchool.Logo1)} alt="" loading="lazy" style={{ width: "34px", height: "34px", objectFit: "contain", marginBottom: "6px" }} />
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
                                  <img src={sanitizeUrl(pickedLogo)} alt={pickedAway ? game.Away : game.Home} title={`Picks ${pickedAway ? game.Away : game.Home}`} loading="lazy" style={{ width: "34px", height: "34px", objectFit: "contain", flexShrink: 0 }} />
                                ) : (
                                  <div style={{ width: "34px", height: "34px", flexShrink: 0 }} />
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ display: "flex", alignItems: "center", gap: "5px", fontWeight: 900, fontSize: "13px", color: BLUE }}>
                                    {namesByUid[p.id] || p.displayName || "Anonymous Fan"}
                                    {verifiedByUid[p.id] && (
                                      <img src={verifiedBadge} alt="Verified" title="Verified" loading="lazy" style={{ width: "14px", height: "14px" }} />
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

            {/* Pregame/live: comments trail below predictions instead of
                leading them — see the isFinal placement above. */}
            {!isFinal && gameCommentsCard}

            {/* Articles tagged to this game via ArticlesManager.js's "+
                Game" picker — see the relatedArticles fetch above. Absent
                entirely (not an empty-state card) when nothing's tagged,
                same as how Community Predictions only differs from this by
                always rendering its own empty state instead. */}
            {relatedArticles.length > 0 && (
              <div style={{ marginBottom: "28px" }}>
                <div style={{ border: `2px solid ${BLUE}`, borderRadius: "12px", overflow: "hidden" }}>
                  <div style={{ background: BLUE, padding: "10px 16px" }}>
                    <h2 style={{ margin: 0, color: GOLD, fontWeight: 900, fontSize: isMobile ? "15px" : "18px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      📰 Related Articles
                    </h2>
                  </div>
                  <div style={{ height: "3px", background: GOLD }} />
                  <div style={{ padding: isMobile ? "12px" : "16px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
                    {relatedArticles.map((a) => (
                      <Link
                        key={a.id}
                        to={`/news/${a.slug}`}
                        style={{ display: "block", padding: "10px 12px", border: "1px solid #eee", borderRadius: "8px", textDecoration: "none", color: "#222" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = GOLD; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#eee"; }}
                      >
                        <div style={{ fontWeight: 900, fontSize: "14px" }}>{a.titleShort || a.title}</div>
                        {a.publishedAt?.toDate && (
                          <div style={{ fontSize: "12px", color: "#888", marginTop: "2px" }}>
                            {a.publishedAt.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
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

      <GameMarginSidebars contentRef={contentRef} isMobile={isMobile} horizontalPadding={20} excludeGameId={game.id} gameWeek={game.Week} weekSlateUrl={weekSlateUrl} />
    </>
  );
}
