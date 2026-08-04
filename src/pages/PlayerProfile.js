// src/pages/PlayerProfile.js
import { useParams, useNavigate, Link } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import Logo1 from "../assets/Logo1.png";
import HomageLogo from "../assets/homagelogo.png";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import verifiedBadge from "../assets/verified.png";
import LoadingSpinner from "../components/LoadingSpinner";
import { Helmet } from "react-helmet-async";
import * as htmlToImage from "html-to-image";
import confetti from "canvas-confetti";

// ── Flair badge images (dropped into assets — filenames as uploaded) ───────
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

// ── Grade lock: 2026 prospects only, locked at 8PM ET April 23rd 2026 ────────
const GRADE_LOCK_DATE = new Date("2026-04-23T20:00:00-04:00");

// ── Sidebar list caps ──────────────────────────────────────────────────────
const DRAFT_CLASS_LIMIT = 20;
const SIDEBAR_NEWS_LIMIT = 8;

function sanitizeImgur(url) {
  if (!url) return "";
  if (/^https?:\/\/i\.imgur\.com\/.+\.(png|jpe?g|gif|webp)$/i.test(url)) return url;
  const singleMatch = url.match(/^https?:\/\/imgur\.com\/(?!a\/|gallery\/)([A-Za-z0-9]+)$/i);
  if (singleMatch) return `https://i.imgur.com/${singleMatch[1]}.png`;
  if (/^https?:\/\/imgur\.com\/(a|gallery)\//i.test(url)) return "";
  return url;
}
function sanitizeGoogleDrive(url) {
  if (!url) return "";
  const m = url.match(/https?:\/\/drive\.google\.com\/file\/d\/([^/]+)\//i);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return url;
}
function sanitizeUrl(url) {
  let u = (url || "").trim();
  if (!u) return "";
  if (u.includes("imgur.com")) u = sanitizeImgur(u);
  if (u.includes("drive.google.com")) u = sanitizeGoogleDrive(u);
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

// ── Flair → { image, stroke color } config. The image renders in the
// right-side hero logo square (replacing the second school/CFB logo) and
// the square gets a border in the matching stroke color. Key must match
// the exact string stored in Firestore player.Flair. ──
const FLAIR_CONFIG = {
  "Elite":               { img: EliteFlair,      stroke: "#ff0000",  desc: "Player is one of the best in the country." },
  "Star":                { img: StarFlair,        stroke: "#ebac02", desc: "Player is one of the best at his position." },
  "Diamond in the Rough": { img: DiamondFlair,   stroke: "#00d2ff", desc: "Player has shown flashes of talent and can take the next step with a little more polish." },
  "Under the Radar":     { img: RadarFlair,       stroke: "#79f146", desc: "Player has outperformed his level of hype." },
  "Future Star":         { img: FutureStarFlair,  stroke: "#0055a5", desc: "Player has shown flashes of elite talent." },
  "Alien":               { img: AlienFlair,       stroke: "#5c04c9", desc: "Player has a rare trait." },
  "Second Chance":       { img: SecondFlair,      stroke: "#ff6600", desc: "Player's production or performance may have slipped some but they have a chance to bounce back." },
  "Ahead of the Curve":  { img: CurveFlair,       stroke: "#008aff", desc: "Player has produced early in his CFB career." },
  "Early Impact":        { img: EarlyImpactFlair, stroke: "#009295", desc: "Player has the traits to make an impact early in his college football career. \"High 5-Star\".", tag: "Recruit Grade" },
  "Early Contributor":   { img: EarlyContributorFlair, stroke: "#ff00f0", desc: "Player has a trait or two that will allow him to see the field early in his college football career. \"Low 5-Star/High 4-Star\".", tag: "Recruit Grade" },
  "Year 2 Contributor":  { img: Year2ContributorFlair, stroke: "#3b6b03", desc: "Player is close to CFB ready but needs a little more development before he is ready to contribute. \"4-Star\".", tag: "Recruit Grade" },
  "Developmental":       { img: DevelopmentalFlair, stroke: "#fff600", desc: "Player needs development before he is ready to see the field. \"3-Star\".", tag: "Recruit Grade" },
  // "Raw Talent": image not uploaded yet — add here once you have it, e.g.
  // "Raw Talent": { img: RawTalentFlair, stroke: "#hexcode", desc: "..." },
  "Proven":              { img: ProvenFlair,      stroke: "#00124b", desc: "Player has proven to be an effective college football player." },
};

// ── Trend → visual treatment. badgeBg/badgeBorder color the small icon
// square in both the Top 5 Trending sidebar and match the header trend
// badges (see the "On Fire" / "Breakout" / "Trending Up" tags further down)
// so a player's trend reads consistently everywhere it shows up. softClass
// is the sidebar-only muted glow applied to each row's own box (see the
// wd-*-box-soft keyframes) — deliberately separate from the header tags'
// bolder wd-*-tag animations, which are unchanged. ──
const TREND_STYLE = {
  up: {
    icon: "▲", label: "Up",
    badgeBg: "#16a34a", badgeBorder: "#0f6e33",
    boxBorder: "#bdf0cf",
    softClass: "wd-trendup-box-soft",
  },
  breakout: {
    icon: "⚡", label: "Breakout",
    badgeBg: "#4a535e", badgeBorder: "#2c333b",
    boxBorder: "#bfe6fb",
    softClass: "wd-breakout-box-soft",
  },
  "on fire": {
    // Yellow (not orange) background so the 🔥 glyph itself has contrast to
    // pop against, instead of blending into a same-toned orange square.
    icon: "🔥", label: "On Fire",
    badgeBg: "#ffcc00", badgeBorder: "#b38600",
    boxBorder: "#ffd7ae",
    softClass: "wd-onfire-box-soft",
  },
};

const toTeamSlug = (school) => {
  if (!school) return "";
  return school.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");
};

const formatEligible = (eligible) => {
  if (!eligible) return "";
  const match = String(eligible).match(/^(\d{4})s$/i);
  if (match) return `${match[1]} (Supplemental)`;
  return String(eligible);
};

function teamNameFromAbbr(abbr) {
  const map = {
    ARI:"Arizona Cardinals",ATL:"Atlanta Falcons",BAL:"Baltimore Ravens",BUF:"Buffalo Bills",
    CAR:"Carolina Panthers",CHI:"Chicago Bears",CIN:"Cincinnati Bengals",CLE:"Cleveland Browns",
    DAL:"Dallas Cowboys",DEN:"Denver Broncos",DET:"Detroit Lions",GB:"Green Bay Packers",
    HOU:"Houston Texans",IND:"Indianapolis Colts",JAX:"Jacksonville Jaguars",KC:"Kansas City Chiefs",
    LV:"Las Vegas Raiders",LAC:"Los Angeles Chargers",LAR:"Los Angeles Rams",MIA:"Miami Dolphins",
    MIN:"Minnesota Vikings",NE:"New England Patriots",NO:"New Orleans Saints",NYG:"New York Giants",
    NYJ:"New York Jets",PHI:"Philadelphia Eagles",PIT:"Pittsburgh Steelers",SF:"San Francisco 49ers",
    SEA:"Seattle Seahawks",TB:"Tampa Bay Buccaneers",TEN:"Tennessee Titans",WAS:"Washington Commanders",
  };
  return map[abbr] || abbr;
}

const teamNameToAbbr = {
  "Arizona Cardinals":"ARI","Atlanta Falcons":"ATL","Baltimore Ravens":"BAL","Buffalo Bills":"BUF",
  "Carolina Panthers":"CAR","Chicago Bears":"CHI","Cincinnati Bengals":"CIN","Cleveland Browns":"CLE",
  "Dallas Cowboys":"DAL","Denver Broncos":"DEN","Detroit Lions":"DET","Green Bay Packers":"GB",
  "Houston Texans":"HOU","Indianapolis Colts":"IND","Jacksonville Jaguars":"JAX","Kansas City Chiefs":"KC",
  "Las Vegas Raiders":"LV","Los Angeles Chargers":"LAC","Los Angeles Rams":"LAR","Miami Dolphins":"MIA",
  "Minnesota Vikings":"MIN","New England Patriots":"NE","New Orleans Saints":"NO","New York Giants":"NYG",
  "New York Jets":"NYJ","Philadelphia Eagles":"PHI","Pittsburgh Steelers":"PIT","San Francisco 49ers":"SF",
  "Seattle Seahawks":"SEA","Tampa Bay Buccaneers":"TB","Tennessee Titans":"TEN","Washington Commanders":"WAS",
};

// ── All 32 NFL team abbreviations, ordered to fill an 8x4 grid exactly —
// used by the margin ad's team picker. ──
const NFL_TEAM_ABBRS = [
  "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE",
  "DAL","DEN","DET","GB","HOU","IND","JAX","KC",
  "LV","LAC","LAR","MIA","MIN","NE","NO","NYG",
  "NYJ","PHI","PIT","SF","SEA","TB","TEN","WAS",
];

// ── Shared sidebar shell ──
function SidebarCard({ title, color1, color2, children }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `2px solid ${color1}` }}>
      <div style={{ backgroundColor: color1, padding: "12px 14px", textAlign: "center" }}>
        <div className="font-black uppercase" style={{ color: "#fff", fontSize: "20px", letterSpacing: "0.08em", textAlign: "center" }}>
          {title}
        </div>
      </div>
      <div style={{ height: "4px", backgroundColor: color2 }} />
      <div style={{ background: "#fff" }}>{children}</div>
    </div>
  );
}

// ── Renders evaluation text with lines starting in •, -, or * grouped into
// real bullet lists; everything else renders as normal paragraphs. Used
// anywhere a saved evaluation is displayed (Scout's Take, public feed,
// archived snapshot, export card) so plain text still works unchanged.
function renderEvaluationText(text, keyPrefix = "ev") {
  if (!text) return null;
  const lines = text.split("\n");
  const blocks = [];
  let currentList = [];

  const flushList = () => {
    if (currentList.length > 0) {
      blocks.push(
        <ul
          key={`${keyPrefix}-ul-${blocks.length}`}
          style={{
            margin: "0 0 8px 0",
            paddingLeft: "20px",
            listStyleType: "disc",
            listStylePosition: "outside",
          }}
        >
          {currentList.map((item, i) => (
            <li key={i} style={{ display: "list-item", marginBottom: "4px" }}>{item}</li>
          ))}
        </ul>
      );
      currentList = [];
    }
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[•\-*]\s+(.*)/);
    if (bulletMatch) {
      currentList.push(bulletMatch[1]);
    } else {
      flushList();
      if (trimmed) {
        blocks.push(<p key={`${keyPrefix}-p-${blocks.length}`} style={{ margin: "0 0 8px 0" }}>{trimmed}</p>);
      }
    }
  });
  flushList();
  return blocks;
}

const PUBLIC_EVAL_LINE_LIMIT = 8;

// ── Truncates a public evaluation to PUBLIC_EVAL_LINE_LIMIT lines (not
// characters) with a Show More/Less toggle. Line-based so a bulleted
// evaluation never gets cut mid-bullet — each hidden/shown unit is always a
// whole line. Only used in the Public Evaluations feed. ──
function TruncatedEvaluationText({ text, keyPrefix, color }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const lines = text.split("\n");
  const isLong = lines.length > PUBLIC_EVAL_LINE_LIMIT;
  const displayText = !isLong || expanded ? text : lines.slice(0, PUBLIC_EVAL_LINE_LIMIT).join("\n");
  return (
    <>
      {renderEvaluationText(displayText, keyPrefix)}
      {isLong && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="font-black uppercase hover:underline"
          style={{ fontSize: "11px", letterSpacing: "0.08em", color: color, background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          {expanded ? "Show Less" : "Show More"}
        </button>
      )}
    </>
  );
}

export default function PlayerProfile() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [player, setPlayer] = useState(null);
  const { user, login } = useAuth();
  const evaluationFormRef = useRef(null);
  const exportCardRef = useRef(null);
  const evaluationTextareaRef = useRef(null);
  const [draftedBy, setDraftedBy] = useState(null);
  const [draftInfo, setDraftInfo] = useState(null);
  const [playerNews, setPlayerNews] = useState([]);
  const [playerVideos, setPlayerVideos] = useState([]);
  const [visibleVideoCount, setVisibleVideoCount] = useState(3);
  const [scoutName, setScoutName] = useState("");
  const [branding, setBranding] = useState(null);
  const cfbLogoRef = useRef("");
  const cfbWordmarkRef = useRef("");
  const schoolSlugRef = useRef("");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [evalCount, setEvalCount] = useState(0);
  const [seoDataReady, setSeoDataReady] = useState(false);
  const [brandingReady, setBrandingReady] = useState(false);
  const [pageVisible, setPageVisible] = useState(false);

  const [grade, setGrade] = useState("");
  const [strengths, setStrengths] = useState([]);
  const [weaknesses, setWeaknesses] = useState([]);
  const [nflFit, setNflFit] = useState("");
  const [evaluation, setEvaluation] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [saving, setSaving] = useState(false);
  const [traits, setTraits] = useState({});
  const [community, setCommunity] = useState({ avgGrade: null, topStrengths: [], topWeaknesses: [], topFits: [] });
  const [publicFeed, setPublicFeed] = useState([]);
  const [visibleCount, setVisibleCount] = useState(3);
  const [fitLogos, setFitLogos] = useState([]);
  const [nflFitLogo, setNflFitLogo] = useState("");
  const [feedLogoCache, setFeedLogoCache] = useState({});
  const [archivedEval, setArchivedEval] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [playerStats, setPlayerStats] = useState(null);
  const [trend, setTrend] = useState(null);
  const [reactionCounts, setReactionCounts] = useState({ likes: 0, up: 0, down: 0 });
  const [myReaction, setMyReaction] = useState({ liked: false, vote: null });
  // Right-side hero box (flair badge, or team logo when there's no flair) and
  // left-side hero box (school/NFL logo) each "grow" into their own popup on
  // hover/tap rather than showing a separate floating tooltip card.
  const [showRightBoxTip, setShowRightBoxTip] = useState(false);
  const [showLeftBoxTip, setShowLeftBoxTip] = useState(false);
  const [showBreakoutAnim, setShowBreakoutAnim] = useState(false);
  const [showBreakoutTip, setShowBreakoutTip] = useState(false);
  const [showTrendUpTip, setShowTrendUpTip] = useState(false);
  const [showOnFireTip, setShowOnFireTip] = useState(false);

  // ── Sponsored margin ads (Homage) — desktop-only, wide-viewport-only.
  // Layout (width + per-side offset) is measured from the actual rendered
  // content grid via mainGridRef, not estimated from window.innerWidth minus
  // an assumed 1600px — that guess doesn't account for padding, box-sizing,
  // or the scrollbar, which is why it kept hugging the edge incorrectly. ──
  const mainGridRef = useRef(null);
  const [showMarginAds, setShowMarginAds] = useState(false);
  const [adData, setAdData] = useState(null);
  const [allAds, setAllAds] = useState([]);
  const [adVisible, setAdVisible] = useState(false);
  const [adTeamBranding, setAdTeamBranding] = useState(null);
  const [adLayout, setAdLayout] = useState({ width: 140, leftGutter: 0, rightGutter: 0 });

  // ── Draft class sidebar ──
  const [draftClassPlayers, setDraftClassPlayers] = useState([]);
  const [draftClassLoading, setDraftClassLoading] = useState(false);
  const [classRank, setClassRank] = useState(null);
  const [classSize, setClassSize] = useState(0);

  // ── Top 5 Trending sidebar — site-wide spotlight, same on every player
  // page. Order is curated by drag-and-drop in the Admin Panel's Active
  // Trends list (trends/{slug}.Order); not tied to whichever player is
  // currently being viewed, so this only needs to fetch once. ──
  const [trendingTop5, setTrendingTop5] = useState([]);
  const [trendingLoaded, setTrendingLoaded] = useState(false);
  const [hoveredTrendSlug, setHoveredTrendSlug] = useState(null);

  // ── Measures the real left/right gutter around the content grid (the
  // space actually left over, not an estimate) and derives the ad card's
  // width + per-side offset so it centers itself in whatever room truly
  // exists, symmetrically, on both sides. The grid has its own 60px
  // horizontal padding (see the style below) — the visible sidebar starts
  // 60px inside the measured box edge, not flush with it, so that padding
  // has to be subtracted or the ad ends up centered against invisible
  // padding instead of the actual visible content, making it look like it's
  // hugging the outer browser edge. ──
  const CONTENT_H_PADDING = 60;
  const recomputeAdLayout = () => {
    if (isMobile || !mainGridRef.current) { setShowMarginAds(false); return; }
    const rect = mainGridRef.current.getBoundingClientRect();
    const visibleLeftEdge = rect.left + CONTENT_H_PADDING;
    const visibleRightEdge = rect.right - CONTENT_H_PADDING;
    const leftGutter = Math.max(0, visibleLeftEdge);
    const rightGutter = Math.max(0, window.innerWidth - visibleRightEdge);
    const minGutter = Math.min(leftGutter, rightGutter);
    const MIN_USABLE_GUTTER = 160; // below this, there's no sensible room for a card + breathing room
    if (minGutter < MIN_USABLE_GUTTER) { setShowMarginAds(false); return; }
    const width = Math.max(140, Math.min(240, minGutter - 16));
    setAdLayout({ width, leftGutter, rightGutter });
    setShowMarginAds(true);
  };

  useEffect(() => {
    const handler = () => {
      setIsMobile(window.innerWidth < 768);
      recomputeAdLayout();
    };
    window.addEventListener("resize", handler);

    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── The grid ref has no real size until content actually renders — recompute
  // once pageVisible flips true (and again shortly after, in case fonts/images
  // still nudge the layout). ──
  useEffect(() => {
    if (!pageVisible) return;
    recomputeAdLayout();
    const t = setTimeout(recomputeAdLayout, 300);
    return () => clearTimeout(t);
  }, [pageVisible]);

  const gradeScale = {
    "Early First Round":1,"Middle First Round":2,"Late First Round":3,"Second Round":4,
    "Third Round":5,"Fourth Round":6,"Fifth Round":7,"Sixth Round":8,"Seventh Round":9,"UDFA":10,
  };
  const gradeLabels = {
    1:"Early First Round",2:"Middle First Round",3:"Late First Round",4:"Second Round",
    5:"Third Round",6:"Fourth Round",7:"Fifth Round",8:"Sixth Round",9:"Seventh Round",10:"UDFA",
  };
  const gradeDisplay = (g) => {
    const map = {
      "Watchlist":          { short:"W",   bg:"#5F5E5A", border:"#444441" },
      "Early First Round":  { short:"1st", bg:"#3B6D11", border:"#27500A" },
      "Middle First Round": { short:"1st", bg:"#3B6D11", border:"#27500A" },
      "Late First Round":   { short:"1st", bg:"#3B6D11", border:"#27500A" },
      "Second Round":       { short:"2nd", bg:"#0F6E56", border:"#085041" },
      "Third Round":        { short:"3rd", bg:"#185FA5", border:"#0C447C" },
      "Fourth Round":       { short:"4th", bg:"#BA7517", border:"#854F0B" },
      "Fifth Round":        { short:"5th", bg:"#BA7517", border:"#854F0B" },
      "Sixth Round":        { short:"6th", bg:"#993C1D", border:"#712B13" },
      "Seventh Round":      { short:"7th", bg:"#993C1D", border:"#712B13" },
      "UDFA":               { short:"U",   bg:"#A32D2D", border:"#791F1F" },
    };
    return map[g] || { short:g, bg:"#5F5E5A", border:"#444441" };
  };

  // Skews raw percentages so bars read as "more filled" at a glance — a low
  // exponent (< 0.5) pushes small percentages up more aggressively than a
  // straight square root did. Tune BAR_SKEW_EXPONENT to taste: lower = fuller.
  const BAR_SKEW_EXPONENT = 0.3;
  const barPct = (pct) => Math.pow(pct/100, BAR_SKEW_EXPONENT) * 100;

  const bannedWords = ["faggot","nigger","monkey","nigga","fuck"];
  const containsProfanity = (text) => {
    if (!text) return false;
    return bannedWords.some((w) => text.toLowerCase().includes(w));
  };

  // ── Reset immediately when navigating to a new player, so stale content
  // (old team colors, old name, etc.) doesn't linger while the next player's
  // data streams in piecemeal — and jump the viewport back to the top. ──
  useEffect(() => {
    setPlayer(null);
    setPageVisible(false);
    setSeoDataReady(false);
    setBrandingReady(false);
    setReactionCounts({ likes: 0, up: 0, down: 0 });
    setMyReaction({ liked: false, vote: null });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [slug]);

  // ── Tells Prerender.io's headless browser when this page's SEO-critical
  // data — grades/evaluations (below) AND school branding/logo (separate
  // fetch, see the branding effect above) — has actually finished loading,
  // instead of letting it guess via a fixed timeout or the browser's `load`
  // event, which fires once the JS bundle executes, long before the
  // Firestore reads this page depends on have resolved. Without this,
  // Prerender.io can snapshot the page mid-fetch — sidebar stuck on
  // "Loading...", grade sections empty, or (as seen after the first fix
  // attempt) the school logo box rendering empty even though the flair icon
  // loaded fine, since that one comes from a separate fetch this didn't
  // originally account for. Requires ALL tracked fetches to report ready,
  // not just one, so a single slow dependency can't slip through again. A
  // capped safety timeout forces readiness anyway after 8s so a slow or
  // failed fetch can't hang Prerender.io indefinitely. ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.prerenderReady = false;
    const safetyTimer = setTimeout(() => { window.prerenderReady = true; }, 8000);
    return () => clearTimeout(safetyTimer);
  }, [slug]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (seoDataReady && brandingReady) window.prerenderReady = true;
  }, [seoDataReady, brandingReady]);

  useEffect(() => {
    const fetch = async () => {
      try {
        const q = query(collection(db,"players"), where("Slug","==",slug));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0];
          const data = {...d.data()};
          const fortyKey = Object.keys(data).find((k) => k.replace(/\s/g,"") === "40Yard");
          if (fortyKey) data["40 Yard"] = data[fortyKey];
          setPlayer({ id:d.id, ...data });
        }
      } catch(e) { console.error(e); }
    };
    fetch();
  }, [slug]);

  // ── Fade the page in once the core player doc has loaded, instead of
  // popping straight to fully-rendered content. ──
  useEffect(() => {
    if (!player) return;
    const t = setTimeout(() => setPageVisible(true), 20);
    return () => clearTimeout(t);
  }, [player]);

  // ── Sponsored margin ads (Homage). Deliberately deferred to be the very
  // last network call the page makes: waits for pageVisible (so it never
  // competes with real content), then adds its own delay on top. Selection
  // priority: (1) the team that actually drafted this player, if drafted —
  // feels intentional rather than random; (2) the player's college's NFL
  // affiliate (Schools sheet's NFL column — a scouting/feeder relationship,
  // not a draft outcome) for undrafted prospects; (3) random, as a last
  // resort. Fails silently — an ad that doesn't load should never be
  // visible as a broken/blank state. ──
  useEffect(() => {
    if (isMobile || !showMarginAds || !pageVisible) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const snap = await getDocs(collection(db, "ads"));
        const ads = snap.docs.map((d) => d.data()).filter((a) => a.Link && a.Image1);
        if (!cancelled && ads.length > 0) {
          setAllAds(ads);
          const draftedAd = draftedBy ? ads.find((a) => a.Team === draftedBy) : null;
          const affiliateAd = !draftedAd && branding?.nflAffiliate
            ? ads.find((a) => a.Team === branding.nflAffiliate)
            : null;
          setAdData(draftedAd || affiliateAd || ads[Math.floor(Math.random() * ads.length)]);
        }
      } catch (e) { /* ads are non-critical — fail silently */ }
    }, 1500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [isMobile, showMarginAds, pageVisible, draftedBy, branding?.nflAffiliate]);

  useEffect(() => {
    if (!adData) return;
    const t = setTimeout(() => setAdVisible(true), 20);
    return () => clearTimeout(t);
  }, [adData]);

  // ── The right-side ad card is stylized to whichever team is currently
  // selected (shared `adData` state, driven by the left card's picker) —
  // pull that team's real Color1/Color2/Logo from the nfl collection. ──
  useEffect(() => {
    if (!adData?.Team) { setAdTeamBranding(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "nfl", adData.Team));
        if (!cancelled) setAdTeamBranding(snap.exists() ? snap.data() : null);
      } catch (e) {
        if (!cancelled) setAdTeamBranding(null);
      }
    })();
    return () => { cancelled = true; };
  }, [adData?.Team]);

  useEffect(() => {
    if (!slug) return;
    const fetch = async () => {
      try {
        const q = query(collection(db,"draftOrder"), where("Selection","==",slug));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0].data();
          setDraftedBy(d.Team);
          setDraftInfo({ round:d.Round, pick:d.Pick });
        }
      } catch(e) { console.error(e); }
    };
    fetch();
  }, [slug]);

  useEffect(() => {
    const fetch = async () => {
      if (!user?.uid) return;
      try {
        const snap = await getDoc(doc(db,"users",user.uid));
        setScoutName(snap.exists() ? (snap.data().username || user.email || "Anonymous Scout") : (user.email || "Anonymous Scout"));
      } catch(e) { setScoutName(user.email || "Anonymous Scout"); }
    };
    fetch();
  }, [user]);

  useEffect(() => {
    if (!slug) return;
    const fetch = async () => {
      try {
        // 1. Player-specific news and articles
        const newsSnap = await getDocs(query(collection(db,"news"), where("active","==",true), where("slugs","array-contains",slug), orderBy("publishedAt","desc")));
        const playerNewsItems = newsSnap.docs.map((d) => ({ id:d.id, type:"news", _priority:1, ...d.data() }));

        let playerArticleItems = [];
        if (player?.id) {
          try {
            const articleSnap = await getDocs(query(collection(db,"articles"), where("status","==","published"), where("playerIds","array-contains",player.id), orderBy("publishedAt","desc")));
            playerArticleItems = articleSnap.docs.map((d) => ({ id:d.id, type:"article", _priority:1, ...d.data() }));
          } catch(articleErr) {
            console.warn("Articles index missing, skipping:", articleErr);
          }
        }

        // 2. School articles — fill remaining slots when player content is sparse
        const existingIds = new Set([...playerNewsItems, ...playerArticleItems].map((n) => n.id));
        let schoolItems = [];
        if (player?.School) {
          const schoolSlug = toTeamSlug(player.School);
          try {
            const [schoolArticleSnap, schoolNewsSnap] = await Promise.all([
              getDocs(query(collection(db,"articles"), where("status","==","published"), where("slugs","array-contains",schoolSlug), limit(8))),
              getDocs(query(collection(db,"news"), where("active","==",true), where("slugs","array-contains",schoolSlug), limit(8))),
            ]);
            schoolItems = [
              ...schoolArticleSnap.docs.map((d) => ({ id:d.id, type:"article", _priority:2, ...d.data() })),
              ...schoolNewsSnap.docs.map((d) => ({ id:d.id, type:"news", _priority:2, ...d.data() })),
            ].filter((n) => !existingIds.has(n.id));
          } catch(e) { /* school articles unavailable */ }
        }

        // Sort: player content first, school content second, each sorted by date within group
        const combined = [...playerArticleItems, ...playerNewsItems, ...schoolItems].sort((a, b) => {
          if (a._priority !== b._priority) return a._priority - b._priority;
          return (b.publishedAt?.toMillis?.() || 0) - (a.publishedAt?.toMillis?.() || 0);
        });

        setPlayerNews(combined);
      } catch(e) { setPlayerNews([]); }
    };
    fetch();
  }, [slug, player?.id, player?.School]);

  // ── Videos attached to this player's ID (Google Sheet "Videos" tab synced
  // to the `videos` collection, migrated from slug- to playerId-keyed items —
  // see AdminPanel.js VideosSection). Each video can reference up to 3
  // players, each with its own title/thumb override — fall back to items[0]
  // if this player's own tag has no override set. ──
  useEffect(() => {
    if (!player?.id) return;
    const fetch = async () => {
      try {
        const snap = await getDocs(query(collection(db,"videos"), where("playerIds","array-contains",player.id)));
        const toMs = (ts) => ts?.toDate?.() ? ts.toDate().getTime() : typeof ts==="number" ? ts : Date.parse(ts)||0;
        const vids = snap.docs
          .map((d) => {
            const data = d.data();
            const items = Array.isArray(data.items) ? data.items : [];
            const matched = items.find((it) => it.playerId === player.id) || null;
            const first = items[0] || null;
            return {
              id: d.id,
              video: data.Video || "",
              date: data.Date || null,
              title: matched?.title || first?.title || "",
              thumb: matched?.thumb || first?.thumb || "",
            };
          })
          .filter((v) => v.video)
          .sort((a, b) => toMs(b.date) - toMs(a.date));
        setPlayerVideos(vids);
        setVisibleVideoCount(3);
      } catch(e) { setPlayerVideos([]); }
    };
    fetch();
  }, [player?.id]);

  useEffect(() => {
    const fetch = async () => {
      if (!player?.School) { setBranding(null); setBrandingReady(true); return; }
      try {
        const sSnap = await getDoc(doc(db,"schools",player.School));
        if (sSnap.exists()) {
          const b = sSnap.data();
          cfbLogoRef.current = b.Logo1 || b.Logo2 || "";
          cfbWordmarkRef.current = b.Wordmark || "";
          schoolSlugRef.current = b.Slug || "";
          setBranding({ color1:b.Color1||SITE_BLUE, color2:b.Color2||SITE_GOLD, logo1:b.Logo1||"", logo2:b.Logo2||"", wordmark:b.Wordmark||"", slug:b.Slug||"", nflAffiliate:b.NFL||"" });
        } else { setBranding(null); }
      } catch(e) { setBranding(null); }
      finally {
        // Marks the school logo/branding fetch as done, same reasoning as
        // seoDataReady below — the flair icon renders instantly from
        // player.Flair (no fetch needed), but the school logo box depends on
        // this separate async call, and was slipping through the original
        // prerenderReady gate because it only watched the evaluations fetch.
        setBrandingReady(true);
      }
    };
    fetch();
  }, [player]);

  useEffect(() => {
    if (!draftedBy) return;
    const fetch = async () => {
      try {
        const snap = await getDoc(doc(db,"nfl",draftedBy));
        if (snap.exists()) {
          const n = snap.data();
          setBranding({ color1:n.Color1, color2:n.Color2, nflLogo:n.Logo1, cfbLogo:cfbLogoRef.current, cfbWordmark:cfbWordmarkRef.current, slug:schoolSlugRef.current });
        }
      } catch(e) { console.error(e); }
    };
    fetch();
  }, [draftedBy]);

  const color1 = draftedBy ? branding?.color1 : (branding?.color1 || SITE_BLUE);
  const color2 = draftedBy ? branding?.color2 : (branding?.color2 || SITE_GOLD);
  const teamSlug = branding?.slug || toTeamSlug(player?.School);

  useEffect(() => {
    const fetch = async () => {
      if (!player?.Position) return;
      try {
        const [posSnap, genSnap] = await Promise.all([getDoc(doc(db,"traits",player.Position)), getDoc(doc(db,"traits","Generic"))]);
        const g = {};
        if (posSnap.exists()) g["Position Specific"] = (posSnap.data().traits||[]).sort();
        if (genSnap.exists()) g["Generic"] = (genSnap.data().traits||[]).sort();
        setTraits(g);
      } catch(e) { console.error(e); }
    };
    fetch();
  }, [player]);

useEffect(() => {
  const fetch = async () => {
    if (!user || !player?.id) return;
    // Always reset first so switching to an unevaluated player clears the form
    setGrade(""); setStrengths([]); setWeaknesses([]);
    setNflFit(""); setEvaluation(""); setVisibility("public"); setLastUpdated(null);
    try {
      const snap = await getDoc(doc(db,"users",user.uid,"evaluations",player.id));
      if (snap.exists()) {
        const d = snap.data();
        setGrade(d.grade||""); setStrengths(d.strengths||[]); setWeaknesses(d.weaknesses||[]);
        setNflFit(d.nflFit||""); setEvaluation(d.evaluation||"");
        setVisibility(d.visibility||"public"); setLastUpdated(d.updatedAt||null);
      }
    } catch(e) { console.error(e); }
  };
  fetch();
}, [user, player]);

  useEffect(() => {
    const fetch = async () => {
      if (!user || !player?.id) return;
      try {
        const snap = await getDoc(doc(db,"users",user.uid,"archivedEvaluations",player.id));
        if (snap.exists()) setArchivedEval(snap.data());
        else setArchivedEval(null);
      } catch(e) { console.error(e); }
    };
    fetch();
  }, [user, player]);

  useEffect(() => {
    const fetch = async () => {
      if (!player?.Slug) return;
      try {
        const snap = await getDoc(doc(db,"playerStats",player.Slug));
        if (snap.exists()) setPlayerStats(snap.data());
        else setPlayerStats(null);
      } catch(e) { console.error(e); }
    };
    fetch();
  }, [player]);

  // ── Fires the full-screen breakout animation once when a player whose
  // Trend is "Breakout" is loaded. Purely cosmetic, never blocks anything. ──
  const triggerBreakoutAnimation = () => {
    setShowBreakoutAnim(true);
    setTimeout(() => setShowBreakoutAnim(false), 2400);
  };

  // ── Trend (Google Sheet "Trends" tab synced to the `trends` collection,
  // keyed by player Slug). Purely cosmetic — never blocks page render. ──
  useEffect(() => {
    const fetch = async () => {
      if (!player?.Slug) { setTrend(null); return; }
      try {
        const snap = await getDoc(doc(db,"trends",player.Slug));
        if (snap.exists()) {
          const data = snap.data();
          setTrend(data);
          const trendVal = (data.Trend || "").toString().trim().toLowerCase();
          if (trendVal === "breakout") triggerBreakoutAnimation();
        } else {
          setTrend(null);
        }
      } catch(e) { setTrend(null); }
    };
    fetch();
  }, [player]);

  // ── Top 5 Trending sidebar data — same list on every player page, so this
  // fetches once rather than re-running per player. Filters by Shown === true
  // client-side rather than a where()+orderBy() query — "shown" is an
  // explicit field, not a position within the collection, and the whole
  // trends collection is small (admin-curated), so there's no real cost to
  // reading all of it and sorting here instead of needing a composite index. ──
  useEffect(() => {
    const fetchTrending = async () => {
      try {
        const snap = await getDocs(collection(db, "trends"));
        const shown = snap.docs
          .map((d) => ({ slug: d.id, ...d.data() }))
          .filter((t) => t.Shown === true)
          .sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0))
          .slice(0, 5);
        setTrendingTop5(shown);
      } catch (e) {
        console.error("Failed to load trending players:", e);
        setTrendingTop5([]);
      } finally {
        setTrendingLoaded(true);
      }
    };
    fetchTrending();
  }, []);

  useEffect(() => {
    const fetch = async () => {
      if (!player?.id) return;
      try {
        const evalsSnap = await getDocs(collection(db,"players",player.id,"evaluations"));
        if (!evalsSnap.empty) {
          setEvalCount(evalsSnap.size);
          let grades=[], sC={}, wC={}, fC={}, pubEvals=[];
          const pubUids = new Set();
          evalsSnap.forEach((d) => {
            const data = d.data();
            if (data.grade && gradeScale[data.grade]) grades.push(gradeScale[data.grade]);
            if (Array.isArray(data.strengths)) data.strengths.forEach((s) => (sC[s]=(sC[s]||0)+1));
            if (Array.isArray(data.weaknesses)) data.weaknesses.forEach((w) => (wC[w]=(wC[w]||0)+1));
            if (data.nflFit) fC[data.nflFit]=(fC[data.nflFit]||0)+1;
            if (data.visibility==="public" && data.evaluation && data.evaluation.trim() !== "" && !containsProfanity(data.evaluation)) {
              pubEvals.push({ id:d.id, ...data });
              if (data.uid) pubUids.add(data.uid);
            }
          });
          const userDocs = await Promise.all(Array.from(pubUids).map((uid) => getDoc(doc(db,"users",uid))));
          const uMap = {};
          userDocs.forEach((snap) => { if (snap.exists()) { const u=snap.data(); uMap[snap.id]={name:u.username||"Anonymous User", verified:u.verified||false}; } });
          const toMs = (ts) => ts?.toDate?.() ? ts.toDate().getTime() : typeof ts==="number" ? ts : Date.parse(ts)||0;
          const pubWithNames = pubEvals
            .map((ev) => ({ ...ev, username:uMap[ev.uid]?.name||"Anonymous User", verified:uMap[ev.uid]?.verified||false }))
            .sort((a,b) => { if (a.verified&&!b.verified) return -1; if (!a.verified&&b.verified) return 1; return toMs(b.updatedAt)-toMs(a.updatedAt); });
          const totalReports = evalsSnap.size;
          const dedupedS = Object.entries(sC).filter(([term,count]) => count >= (wC[term] ?? -Infinity));
          const dedupedW = Object.entries(wC).filter(([term,count]) => count > (sC[term] ?? -Infinity));
          setCommunity({
            avgGrade: grades.length>0 ? (grades.reduce((a,b)=>a+b,0)/grades.length).toFixed(1) : null,
            topStrengths: dedupedS.sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,count])=>({ term:s, pct:(count/totalReports)*100 })),
            topWeaknesses: dedupedW.sort((a,b)=>b[1]-a[1]).slice(0,5).map(([w,count])=>({ term:w, pct:(count/totalReports)*100 })),
            topFits: Object.entries(fC).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([t])=>t),
          });
          setPublicFeed(pubWithNames);
        } else {
          setCommunity({ avgGrade:null, topStrengths:[], topWeaknesses:[], topFits:[] });
          setPublicFeed([]);
        }
      } catch(e) { console.error(e); }
      finally {
        // Marks the SEO-critical data fetch as done regardless of success,
        // empty result, or error — see the prerenderReady effect below.
        setSeoDataReady(true);
      }
    };
    fetch();
  }, [player]);

  // ── Reactions (like/upvote/downvote) — same aggregation pattern as
  // community evaluations above: read the whole subcollection, compute
  // totals client-side. No Cloud Functions/counters needed at this scale. ──
  useEffect(() => {
    const fetch = async () => {
      if (!player?.id) return;
      try {
        const snap = await getDocs(collection(db,"players",player.id,"reactions"));
        let likes = 0, up = 0, down = 0;
        let mine = { liked: false, vote: null };
        snap.forEach((d) => {
          const data = d.data();
          if (data.liked) likes++;
          if (data.vote === "up") up++;
          else if (data.vote === "down") down++;
          if (user && d.id === user.uid) mine = { liked: !!data.liked, vote: data.vote || null };
        });
        setReactionCounts({ likes, up, down });
        setMyReaction(mine);
      } catch(e) { console.error(e); }
    };
    fetch();
  }, [player, user]);

  // ── Toggle like: independent of up/down vote. ──
  const handleToggleLike = () => {
    if (!user) { login(); return; }
    if (!player?.id) return;
    const nextLiked = !myReaction.liked;
    setReactionCounts((c) => ({ ...c, likes: c.likes + (nextLiked ? 1 : -1) }));
    setMyReaction((r) => ({ ...r, liked: nextLiked }));
    setDoc(doc(db,"players",player.id,"reactions",user.uid), {
      uid: user.uid, liked: nextLiked, vote: myReaction.vote, updatedAt: serverTimestamp(),
    }, { merge: true }).catch((e) => console.error(e));
  };

  // ── Toggle vote: picking the currently-selected direction again clears it;
  // picking the opposite direction switches (removing the old one). ──
  const handleVote = (direction) => {
    if (!user) { login(); return; }
    if (!player?.id) return;
    const nextVote = myReaction.vote === direction ? null : direction;
    setReactionCounts((c) => {
      const n = { ...c };
      if (myReaction.vote === "up") n.up -= 1;
      if (myReaction.vote === "down") n.down -= 1;
      if (nextVote === "up") n.up += 1;
      if (nextVote === "down") n.down += 1;
      return n;
    });
    setMyReaction((r) => ({ ...r, vote: nextVote }));
    setDoc(doc(db,"players",player.id,"reactions",user.uid), {
      uid: user.uid, liked: myReaction.liked, vote: nextVote, updatedAt: serverTimestamp(),
    }, { merge: true }).catch((e) => console.error(e));
  };

  // ── Fetch draft class (whole class once; position group + class rank both derive from it) ──
  useEffect(() => {
    const fetchDraftClass = async () => {
      if (!player?.Position || !player?.Eligible) {
        setDraftClassPlayers([]); setClassRank(null); setClassSize(0);
        return;
      }
      setDraftClassLoading(true);
      try {
        const q = query(
          collection(db, "players"),
          where("Eligible", "==", player.Eligible)
        );
        const snap = await getDocs(q);
        const list = await Promise.all(
          snap.docs
            .filter((d) => d.id === player.id || d.data().Live !== false)
            .map(async (d) => {
              const data = d.data();
              let avgGrade = null;
              try {
                const evalsSnap = await getDocs(collection(db, "players", d.id, "evaluations"));
                const grades = [];
                evalsSnap.forEach((ev) => {
                  const g = ev.data().grade;
                  if (g && gradeScale[g]) grades.push(gradeScale[g]);
                });
                if (grades.length > 0) avgGrade = grades.reduce((a, b) => a + b, 0) / grades.length;
              } catch { }
              return {
                id: d.id,
                First: data.First || "",
                Last: data.Last || "",
                School: data.School || "",
                Slug: data.Slug || "",
                Position: data.Position || "",
                avgGrade,
                isSelf: d.id === player.id,
              };
            })
        );
        // Mirror the Community Board's ranking: sort by rounded grade label (not raw
        // average), and leave ties in Firestore's natural order — same as CommunityBoard.js —
        // so this rank matches what the board actually shows.
        list.sort((a, b) => {
          const aLabel = a.avgGrade != null ? gradeLabels[Math.round(a.avgGrade)] : null;
          const bLabel = b.avgGrade != null ? gradeLabels[Math.round(b.avgGrade)] : null;
          const aV = aLabel ? gradeScale[aLabel] : null;
          const bV = bLabel ? gradeScale[bLabel] : null;
          if (aV && bV) return aV - bV;
          if (aV && !bV) return -1;
          if (!aV && bV) return 1;
          return 0;
        });
        setDraftClassPlayers(list.filter((p) => p.Position === player.Position));
        const classSelfIndex = list.findIndex((p) => p.isSelf);
        setClassRank(classSelfIndex >= 0 ? classSelfIndex + 1 : null);
        setClassSize(list.length);
      } catch (e) {
        console.error(e);
        setDraftClassPlayers([]);
        setClassRank(null);
        setClassSize(0);
      } finally {
        setDraftClassLoading(false);
      }
    };
    fetchDraftClass();
  }, [player]);

  useEffect(() => {
    if (!publicFeed.length) return;
    const missing = [...new Set(publicFeed.map((ev)=>ev.nflFit).filter(Boolean))].filter((t)=>!feedLogoCache[t]);
    if (!missing.length) return;
    const fetch = async () => {
      const entries = await Promise.all(missing.map(async (tn) => {
        const abbr = teamNameToAbbr[tn];
        if (!abbr) return [tn,null];
        try { const snap=await getDoc(doc(db,"nfl",abbr)); return [tn, snap.exists()?snap.data().Logo1||null:null]; }
        catch { return [tn,null]; }
      }));
      setFeedLogoCache((prev)=>({...prev,...Object.fromEntries(entries)}));
    };
    fetch();
  }, [publicFeed]);

  useEffect(() => {
    const fetch = async () => {
      if (!nflFit) { setNflFitLogo(""); return; }
      const abbr = teamNameToAbbr[nflFit];
      if (!abbr) { setNflFitLogo(""); return; }
      try { const snap=await getDoc(doc(db,"nfl",abbr)); setNflFitLogo(snap.exists()?snap.data().Logo1||"":""); }
      catch { setNflFitLogo(""); }
    };
    fetch();
  }, [nflFit]);

  useEffect(() => {
    const fetch = async () => {
      if (!community.topFits.length) { setFitLogos([]); return; }
      try {
        const logos = await Promise.all(community.topFits.map(async (tn) => {
          const abbr = teamNameToAbbr[tn];
          if (!abbr) return {teamName:tn, logo:null};
          const snap = await getDoc(doc(db,"nfl",abbr));
          return {teamName:tn, logo:snap.exists()?snap.data().Logo1:null};
        }));
        setFitLogos(logos);
      } catch(e) { setFitLogos([]); }
    };
    fetch();
  }, [community.topFits]);

  const handleExportImage = async () => {
    if (!exportCardRef.current) return;
    try {
      const dataUrl = await htmlToImage.toPng(exportCardRef.current, { pixelRatio:2, backgroundColor:"#ffffff", skipFonts:true, filter:(node)=>node.tagName!=="IMG" });
      const link = document.createElement("a");
      link.download = `${player.First}_${player.Last}_Evaluation.png`;
      link.href = dataUrl; link.click();
    } catch(e) { alert("Failed to export image. Please try again."); }
  };

  // ── Insert a bullet line into the evaluation textarea at the cursor,
  // starting a new line if the cursor isn't already at the start of one.
  const handleInsertBullet = () => {
    const el = evaluationTextareaRef.current;
    if (!el) {
      setEvaluation((prev) => (prev && !prev.endsWith("\n") ? prev + "\n• " : prev + "• "));
      return;
    }
    const start = el.selectionStart ?? evaluation.length;
    const end = el.selectionEnd ?? evaluation.length;
    const before = evaluation.slice(0, start);
    const after = evaluation.slice(end);
    const needsNewline = before.length > 0 && !before.endsWith("\n");
    const insert = `${needsNewline ? "\n" : ""}• `;
    const next = before + insert + after;
    setEvaluation(next);
    const cursorPos = before.length + insert.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursorPos, cursorPos);
    });
  };

  const handleSaveEvaluation = async () => {
    if (!user||!player?.id) return alert("You must sign in first.");
    if (visibility==="public"&&containsProfanity(evaluation)) return alert("❌ Your evaluation contains inappropriate language.");
    const gradeLocked = player?.Eligible === "2026" && new Date() >= GRADE_LOCK_DATE;
    setSaving(true);
    try {
      let savedGrade = grade;
      if (gradeLocked) {
        const existing = await getDoc(doc(db,"users",user.uid,"evaluations",player.id));
        savedGrade = existing.exists() ? (existing.data().grade || grade) : grade;
      }
      const evalData = {
        uid:user.uid, email:user.email, playerId:player.id,
        playerName:`${player.First||""} ${player.Last||""}`.trim(),
        grade: savedGrade, strengths, weaknesses, nflFit, evaluation, visibility,
        updatedAt:serverTimestamp(),
      };
      await setDoc(doc(db,"players",player.id,"evaluations",user.uid), evalData);
      await setDoc(doc(db,"users",user.uid,"evaluations",player.id), evalData);
      confetti({ particleCount:140, spread:75, origin:{y:0.65}, colors:[color1,color2,"#ffffff"] });
      setLastUpdated(Date.now());
    } catch(e) { alert("❌ Failed to save evaluation. Try again."); }
    finally { setSaving(false); }
  };

  async function handleRemoveEvaluation() {
    if (!user||!player?.id) return alert("You must sign in first.");
    if (!window.confirm("Remove evaluation from your board?")) return;
    try {
      const { deleteDoc, doc:fDoc } = await import("firebase/firestore");
      await Promise.all([deleteDoc(fDoc(db,"players",player.id,"evaluations",user.uid)), deleteDoc(fDoc(db,"users",user.uid,"evaluations",player.id))]);
      setGrade(""); setStrengths([]); setWeaknesses([]); setNflFit(""); setEvaluation(""); setVisibility("public"); setLastUpdated(null);
      alert("🗑️ Evaluation removed from your board.");
    } catch(e) { alert("❌ Failed to remove evaluation. Try again."); }
  }

  async function handleArchiveEvaluation() {
    if (!user||!player?.id) return alert("You must sign in first.");
    if (!lastUpdated) return alert("Save your evaluation first before archiving.");
    const overwriteWarning = archivedEval ? "\n\n⚠️ You already have an archived evaluation for this player. This will overwrite it." : "";
    const confirmed = window.confirm(`📦 Archive this evaluation?\n\nArchiving takes a snapshot of your current evaluation and locks it as a read-only record. Your current evaluation will be cleared so you can start fresh.\n\nYou can only have one archive per player — archiving again will overwrite the previous snapshot.${overwriteWarning}`);
    if (!confirmed) return;
    setArchiving(true);
    try {
      const snap = await getDoc(doc(db,"users",user.uid,"evaluations",player.id));
      if (!snap.exists()) return alert("Save your evaluation first before archiving.");
      const data = snap.data();
      const now = new Date();
      const archiveData = { ...data, archivedAt: serverTimestamp(), archivedAtISO: now.toISOString(), playerName: `${player.First||""} ${player.Last||""}`.trim() };
      await setDoc(doc(db,"users",user.uid,"archivedEvaluations",player.id), archiveData);
      const { deleteDoc, doc:fDoc } = await import("firebase/firestore");
      await Promise.all([deleteDoc(fDoc(db,"players",player.id,"evaluations",user.uid)), deleteDoc(fDoc(db,"users",user.uid,"evaluations",player.id))]);
      setArchivedEval({ ...archiveData, archivedAt: { toDate: () => now } });
      setGrade(""); setStrengths([]); setWeaknesses([]); setNflFit(""); setEvaluation(""); setVisibility("public"); setLastUpdated(null);
      alert("📦 Evaluation archived and current eval cleared. You can now start a fresh evaluation.");
    } catch(e) { console.error(e); alert("❌ Failed to archive evaluation. Try again."); }
    finally { setArchiving(false); }
  }

  const renderDate = (ts) => {
    if (!ts) return "";
    try { return ts?.toDate?.() ? ts.toDate().toLocaleString() : typeof ts==="number" ? new Date(ts).toLocaleString() : new Date(ts).toLocaleString(); }
    catch { return ""; }
  };

  if (!player) return <LoadingSpinner label="Loading Player" size={56} minHeight="100vh" />;

  const gradeIsLocked = player?.Eligible === "2026" && new Date() >= GRADE_LOCK_DATE;
  const isTrendingUp = (trend?.Trend || "").toString().trim().toLowerCase() === "up";
  const isBreakoutTrend = (trend?.Trend || "").toString().trim().toLowerCase() === "breakout";
  const isOnFireTrend = (trend?.Trend || "").toString().trim().toLowerCase() === "on fire";
  const breakoutStats = (trend?.Notes || "").toString().split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const trendNotesList = breakoutStats;

  // ── Flair lookup — drives the right-side hero logo square + its stroke ──
  const flairInfo = player.Flair ? FLAIR_CONFIG[String(player.Flair).trim()] : null;

  const buildMetaDescription = () => {
    const name = `${player.First || ""} ${player.Last || ""}`.trim();
    const prefix = [player.School, player.Position].filter(Boolean).join(" ");

    // Try to pull first 12 words from the top public evaluation
    const latestEval = publicFeed[0]?.evaluation?.trim();
    if (latestEval) {
      const words = latestEval.split(/\s+/);
      const first12 = words.slice(0, 12).join(" ");
      const snippet = first12 + (words.length > 12 ? "..." : "");
      return `${prefix ? prefix + ": " : ""}${snippet} View the full evaluation, grades, measurables, and film.`;
    }

    // Fallback: no evaluations yet
    return `${prefix ? prefix + " — " : ""}Read ${name}'s scouting report, including strengths, weaknesses, NFL projection, current draft grade, measurables, and the latest evaluations from We Draft.`;
  };
  const metaDescription = buildMetaDescription();

  const physicalMeasurements = [
    {val:player.Height,label:"Height"},{val:player.Weight,label:"Weight"},
    {val:player.Wingspan,label:"Wing"},{val:player["Arm Length"],label:"Arm"},{val:player["Hand Size"],label:"Hand"},
  ].filter((m)=>m.val);

  const athleticMeasurements = [
    {val:player["40 Yard"],label:"40 Yd"},{val:player.Vertical,label:"Vert"},{val:player.Broad,label:"Broad"},
    {val:player["3-Cone"],label:"3-Cone"},{val:player.Shuttle,label:"Shutt"},{val:player.Bench,label:"Bench"},
  ].filter((m)=>m.val);

  const hasAthletic = athleticMeasurements.length > 0;

  const StatPill = ({ val, label }) => (
    <div style={{ display:"inline-flex", flexDirection:"column", alignItems:"center", background:"#fff", border:`2px solid ${color1}`, borderRadius:"8px", padding:isMobile?"5px 10px":"7px 16px", minWidth:isMobile?"52px":"68px" }}>
      <span style={{ fontSize:isMobile?"13px":"18px", fontWeight:900, color:color1, lineHeight:1.1 }}>{val}</span>
      <span style={{ fontSize:isMobile?"9px":"11px", fontWeight:800, color:"#888", letterSpacing:"0.08em", marginTop:"3px", textTransform:"uppercase" }}>{label}</span>
    </div>
  );

  const GroupLabel = ({ children }) => (
    <div style={{ fontSize:"12px", fontWeight:900, letterSpacing:"0.12em", textTransform:"uppercase", color:"#666", marginBottom:"8px", textAlign:"center" }}>{children}</div>
  );

  // ── Shared fixed-position placement for both margin ad cards, derived from
  // the measured gutter (see recomputeAdLayout above). Kept as one function
  // so the left and right cards always use identical positioning math. ──
  const marginAdPositionStyle = (side) => {
    const gutter = side === "left" ? adLayout.leftGutter : adLayout.rightGutter;
    const offset = Math.max(8, (gutter - adLayout.width) / 2);
    return {
      position: "fixed",
      top: "50%",
      [side]: `${offset}px`,
      transform: "translateY(-50%)",
      width: `${adLayout.width}px`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      zIndex: 5,
      opacity: adVisible ? 1 : 0,
      transition: "opacity 0.7s ease",
    };
  };

  // ── Sponsored margin ad card — lives entirely outside the content grid via
  // position:fixed, so it never competes with the page layout for space.
  // Outer wrapper is a div rather than an anchor because it now contains a
  // real <select> team picker — nesting an interactive control inside an <a>
  // is invalid HTML and breaks click handling, so only the image/copy/CTA
  // portion is wrapped in its own link. Defaults to a random team on load;
  // the picker lets the visitor override that with any team in `allAds`.
  // This is the LEFT card — it drives the shared `adData` selection; the
  // right card (MarginAdTeamCard, below) just follows whatever this picks. ──
  const MarginAd = ({ side }) => {
    if (!adData) return null;
    const teamLabel = teamNameFromAbbr(adData.Team) || adData.Team;
    return (
      <div
        className="wd-margin-ad"
        style={marginAdPositionStyle(side)}
      >
        <div style={{ fontSize:"9px", fontWeight:800, color:"#aaa", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:"6px" }}>
          Sponsored
        </div>
        <div
          className="wd-margin-ad-card"
          style={{
            width:"100%", borderRadius:"14px", overflow:"hidden",
            border:"1px solid #eee", background:"#fff",
            boxShadow:"0 4px 18px rgba(0,0,0,0.08)",
            transition:"box-shadow 0.2s ease, transform 0.2s ease",
          }}
        >
          <div style={{ padding:"9px 10px", borderBottom:"1px solid #f3f3f3" }}>
            <div style={{ fontSize:"9px", fontWeight:900, color:"#c8102e", textTransform:"uppercase", letterSpacing:"0.06em", textAlign:"center" }}>
              {teamLabel}
            </div>
          </div>

          <a
            href={sanitizeUrl(adData.Link)}
            target="_blank"
            rel="sponsored noopener noreferrer"
            style={{ display:"block" }}
          >
            <img
              src={sanitizeUrl(adData.Image1)}
              alt={`${teamLabel} throwback gear`}
              style={{ width:"100%", display:"block", aspectRatio:"1600 / 1920", objectFit:"cover", background:"#fafafa" }}
              loading="lazy"
              fetchpriority="low"
              referrerPolicy="no-referrer"
              onError={(e)=>{e.currentTarget.style.display="none";}}
            />
          </a>

          {/* Always-visible 8x4 grid of all 32 NFL teams, directly under the product shot */}
          <div style={{ padding:"10px 10px 6px", borderTop:"1px solid #f3f3f3" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:"5px" }}>
              {NFL_TEAM_ABBRS.map((abbr) => {
                const teamAd = allAds.find((a) => a.Team === abbr);
                const isActive = adData.Team === abbr;
                return (
                  <button
                    key={abbr}
                    type="button"
                    disabled={!teamAd}
                    title={teamNameFromAbbr(abbr)}
                    className={teamAd ? "wd-team-btn" : ""}
                    onClick={() => { if (teamAd) setAdData(teamAd); }}
                    style={{
                      fontSize:"8.5px", fontWeight:900,
                      padding:"5px 0", borderRadius:"4px",
                      border:`1px solid ${isActive ? "#c8102e" : "#eee"}`,
                      background: isActive ? "#c8102e" : teamAd ? "#fff" : "#f6f6f6",
                      color: isActive ? "#fff" : teamAd ? "#333" : "#ccc",
                      cursor: teamAd ? "pointer" : "not-allowed",
                      transition: "transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease",
                    }}
                  >
                    {abbr}
                  </button>
                );
              })}
            </div>
          </div>

          <a
            href={sanitizeUrl(adData.Link)}
            target="_blank"
            rel="sponsored noopener noreferrer"
            style={{ display:"block", textDecoration:"none" }}
          >
            <div style={{ padding:"9px 12px 12px", textAlign:"center", borderTop:"1px solid #f3f3f3" }}>
              <div style={{ fontSize:"10px", fontWeight:900, color:"#111", textTransform:"uppercase", letterSpacing:"0.02em", marginBottom:"3px" }}>
                Officially Licensed Throwback Apparel
              </div>
              <div style={{ fontSize:"9px", fontWeight:700, color:"#888", lineHeight:1.35, marginBottom:"9px" }}>
                All 32 NFL Teams + MLB, NBA, NHL &amp; More
              </div>
              <div
                className="wd-margin-ad-cta"
                style={{
                  display:"inline-flex", alignItems:"center", gap:"4px",
                  background:"#c8102e", color:"#fff",
                  fontSize:"10px", fontWeight:900,
                  padding:"7px 16px", borderRadius:"20px",
                  textTransform:"uppercase", letterSpacing:"0.05em",
                  transition:"background 0.15s ease",
                }}
              >
                Shop Now →
              </div>
            </div>
          </a>

          <div style={{ padding:"8px 10px", display:"flex", alignItems:"center", justifyContent:"center", borderTop:"1px solid #f3f3f3" }}>
            <img src={HomageLogo} alt="Homage" style={{ height:"12px", objectFit:"contain" }} />
          </div>
        </div>
      </div>
    );
  };

  // ── Right-side companion ad card. Doesn't have its own team picker — it
  // just follows whatever team is currently selected in `adData` (shared
  // state, driven by the left card). Stylized to that team using its real
  // Color1/Color2/Logo1 from adTeamBranding instead of generic Homage red,
  // and shows Image2 + Image3 (a 2-up gallery) instead of Image1, so the two
  // cards read as complementary rather than duplicates of each other. ──
  const MarginAdTeamCard = ({ side }) => {
    if (!adData) return null;
    const teamLabel = teamNameFromAbbr(adData.Team) || adData.Team;
    const tColor1 = adTeamBranding?.Color1 || SITE_BLUE;
    const tColor2 = adTeamBranding?.Color2 || SITE_GOLD;
    const tLogo = adTeamBranding?.Logo1 || adTeamBranding?.Logo2 || "";
    const gallery = [adData.Image2, adData.Image3].filter(Boolean);
    const displayImages = gallery.length > 0 ? gallery : (adData.Image1 ? [adData.Image1] : []);

    return (
      <div
        className="wd-margin-ad"
        style={marginAdPositionStyle(side)}
      >
        <div style={{ fontSize:"9px", fontWeight:800, color:"#aaa", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:"6px" }}>
          Sponsored
        </div>
        <div
          className="wd-margin-ad-card"
          style={{
            width:"100%", borderRadius:"14px", overflow:"hidden",
            border:`2px solid ${tColor1}`, background:"#fff",
            boxShadow:`0 4px 18px ${tColor1}40`,
            transition:"box-shadow 0.2s ease, transform 0.2s ease",
          }}
        >
          <div style={{ background:`linear-gradient(135deg, ${tColor1}, ${tColor1}cc)`, padding:"12px 10px", display:"flex", alignItems:"center", justifyContent:"center" }}>
            {(() => {
              const parts = teamLabel.split(" ");
              const nickname = parts.pop();
              const cityLine = parts.join(" ");
              return (
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", lineHeight:1.15 }}>
                  <div style={{ fontSize:"12px", fontWeight:900, color:"#fff", textTransform:"uppercase", letterSpacing:"0.06em", textAlign:"center" }}>
                    {cityLine}
                  </div>
                  <div style={{ fontSize:"16px", fontWeight:900, color:"#fff", textTransform:"uppercase", letterSpacing:"0.06em", textAlign:"center" }}>
                    {nickname}
                  </div>
                </div>
              );
            })()}
          </div>

          <a
            href={sanitizeUrl(adData.Link)}
            target="_blank"
            rel="sponsored noopener noreferrer"
            style={{ display:"block" }}
          >
            {displayImages.length === 2 ? (
              <div style={{ display:"flex", flexDirection:"column", gap:"2px", background:tColor2 }}>
                {displayImages.map((img, i) => (
                  <img
                    key={i}
                    src={sanitizeUrl(img)}
                    alt={`${teamLabel} gear ${i + 1}`}
                    style={{ width:"100%", display:"block", aspectRatio:"1600 / 1920", objectFit:"cover", background:"#fafafa" }}
                    loading="lazy"
                    fetchpriority="low"
                    referrerPolicy="no-referrer"
                    onError={(e)=>{e.currentTarget.style.display="none";}}
                  />
                ))}
              </div>
            ) : displayImages[0] ? (
              <img
                src={sanitizeUrl(displayImages[0])}
                alt={`${teamLabel} gear`}
                style={{ width:"100%", display:"block", aspectRatio:"1600 / 1920", objectFit:"cover", background:"#fafafa" }}
                loading="lazy"
                fetchpriority="low"
                referrerPolicy="no-referrer"
                onError={(e)=>{e.currentTarget.style.display="none";}}
              />
            ) : null}
          </a>

          <a
            href={sanitizeUrl(adData.Link)}
            target="_blank"
            rel="sponsored noopener noreferrer"
            style={{ display:"block", textDecoration:"none" }}
          >
            <div style={{ padding:"9px 12px 12px", textAlign:"center", borderTop:`1px solid ${tColor1}22` }}>
              <div style={{ fontSize:"10px", fontWeight:900, color:"#111", textTransform:"uppercase", letterSpacing:"0.02em", marginBottom:"3px" }}>
                Officially Licensed Throwback Apparel
              </div>
              <div style={{ fontSize:"9px", fontWeight:700, color:"#888", lineHeight:1.35, marginBottom:"9px" }}>
                All 32 NFL Teams + MLB, NBA, NHL &amp; More
              </div>
              <div
                className="wd-margin-ad-cta-team"
                style={{
                  display:"inline-flex", alignItems:"center", gap:"4px",
                  background:tColor1, color:"#fff",
                  fontSize:"10px", fontWeight:900,
                  padding:"7px 16px", borderRadius:"20px",
                  textTransform:"uppercase", letterSpacing:"0.05em",
                  border:`1px solid ${tColor2}`,
                  transition:"filter 0.15s ease",
                }}
              >
                Shop Now →
              </div>
            </div>
          </a>

          {tLogo && (
            <div style={{ padding:"16px 10px", display:"flex", alignItems:"center", justifyContent:"center", background:"#fff", borderTop:`1px solid ${tColor1}22` }}>
              <img
                src={sanitizeUrl(tLogo)}
                alt={teamLabel}
                style={{ height:"64px", objectFit:"contain" }}
                referrerPolicy="no-referrer"
                onError={(e)=>{e.currentTarget.style.display="none";}}
              />
            </div>
          )}

          <div style={{ padding:"8px 10px", display:"flex", alignItems:"center", justifyContent:"center", borderTop:`1px solid ${tColor1}22` }}>
            <img src={HomageLogo} alt="Homage" style={{ height:"12px", objectFit:"contain" }} />
          </div>
        </div>
      </div>
    );
  };

  const SectionTitle = ({ children }) => (
    <>
      <div className="font-black uppercase mb-2" style={{ color:color1, fontSize:isMobile?"17px":"22px", letterSpacing:"0.08em" }}>{children}</div>
      <div className="mb-4 rounded-sm" style={{ height:"3px", backgroundColor:color1 }} />
    </>
  );

  const GradeBadge = ({ g, large=false }) => {
    const { short, bg, border } = gradeDisplay(g);
    const isFirstRound = ["Early First Round", "Middle First Round", "Late First Round"].includes(g);
    const qualifier = isFirstRound ? g.replace(" First Round", "").toUpperCase() : null;
    return (
      <div className="rounded text-center" style={{ backgroundColor:bg, border:`${large?4:3}px solid ${border}`, padding:large?"10px 16px":"8px 10px", minWidth:large?"100%":"auto", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"1px" }}>
        {qualifier && <div style={{ fontSize:large?"12px":"8px", fontWeight:900, color:"rgba(255,255,255,0.9)", textTransform:"uppercase", letterSpacing:"0.06em", lineHeight:1, textAlign:"center" }}>{qualifier}</div>}
        <div style={{ fontSize:large?"52px":"30px", fontWeight:900, color:"#fff", lineHeight:1, letterSpacing:"-0.02em", textAlign:"center" }}>{short}</div>
        <div style={{ fontSize:large?"10px":"8px", fontWeight:800, color:"rgba(255,255,255,0.8)", textTransform:"uppercase", letterSpacing:"0.07em", textAlign:"center" }}>ROUND</div>
      </div>
    );
  };

  // ── Draft Class list (shared between desktop sidebar and mobile dropdown) ──
  const draftClassLabel = `${formatEligible(player.Eligible)} ${player.Position}`.trim();
  const communityYearPath = String(player.Eligible) === "2027" ? "/community" : `/community/${player.Eligible}`;

  // ── Ensure the current player is always visible even if ranked beyond the cap ──
  const selfIndex = draftClassPlayers.findIndex((p) => p.isSelf);
  const displayList = selfIndex >= DRAFT_CLASS_LIMIT
    ? [...draftClassPlayers.slice(0, DRAFT_CLASS_LIMIT), draftClassPlayers[selfIndex]]
    : draftClassPlayers.slice(0, DRAFT_CLASS_LIMIT);

  const DraftClassListContent = (
    <>
      <Link
        to={communityYearPath}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "10px 14px", textDecoration: "none",
          background: SITE_BLUE, color: SITE_GOLD,
          fontWeight: 900, fontSize: "12px",
          textTransform: "uppercase", letterSpacing: "0.1em",
          gap: "6px", borderBottom: "1px solid #f0f0f0",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#003a7a"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = SITE_BLUE; }}
      >
        Full {formatEligible(player.Eligible)} Board →
      </Link>
      {draftClassLoading ? (
        <LoadingSpinner label="Loading" size={24} minHeight="60px" />
      ) : draftClassPlayers.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>No other prospects yet.</div>
      ) : (
        <>
          {displayList.map((p, i) => {
          const gradeLabel = p.avgGrade != null ? gradeLabels[Math.round(p.avgGrade)] : "Watchlist";
          const gd = gradeDisplay(gradeLabel);
          const rowStyle = {
            display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px",
            textDecoration: "none",
            borderBottom: i < Math.min(displayList.length, DRAFT_CLASS_LIMIT + 1) - 1 ? "1px solid #f0f0f0" : "none",
            background: p.isSelf ? "#fff8e6" : "#fff",
            borderLeft: p.isSelf ? `4px solid ${SITE_GOLD}` : "4px solid transparent",
          };
          const rowContent = (
            <>
              <div
                style={{
                  flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  width: "28px", height: "28px", borderRadius: "5px",
                  backgroundColor: gd.bg,
                  border: `2px solid ${gd.border}`,
                  color: "#fff",
                  fontSize: "10px", fontWeight: 900,
                }}
                title={gradeLabel}
              >
                {gd.short}
              </div>
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ color: SITE_BLUE, fontWeight: 900, fontSize: "14px", lineHeight: 1.2 }}>
                  {`${p.First} ${p.Last}`}
                </span>
                <span style={{ color: "#777", fontWeight: 700, fontSize: "12px", marginTop: "2px" }}>
                  {p.School || "—"}
                </span>
              </div>
            </>
          );
          return p.isSelf ? (
            <div key={p.id} style={rowStyle}>{rowContent}</div>
          ) : (
            <Link key={p.id} to={`/player/${p.Slug}`} style={rowStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f7f9fc"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}>
              {rowContent}
            </Link>
          );
        })}
        </>
      )}
    </>
  );

  // ── Desktop: full sidebar card ──
  const DraftClassList = (
    <SidebarCard title={draftClassLabel} color1={SITE_BLUE} color2={SITE_GOLD}>
      {DraftClassListContent}
    </SidebarCard>
  );

  // ── Mobile: collapsible dropdown ──
  const playerFullName = `${player.First || ""} ${player.Last || ""}`.trim();
  const DraftClassDropdown = (
    <details style={{ border: `2px solid ${SITE_BLUE}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
      <summary style={{
        backgroundColor: SITE_BLUE,
        padding: "10px 14px",
        cursor: "pointer",
        listStyle: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        userSelect: "none",
      }}>
        <div>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {playerFullName}
          </div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontWeight: 700, fontSize: "11px", marginTop: "2px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {draftClassLabel} Class ▾
          </div>
        </div>
        <span style={{ color: SITE_GOLD, fontWeight: 900, fontSize: "18px" }}>⬇</span>
      </summary>
      <div style={{ height: "4px", backgroundColor: SITE_GOLD }} />
      {DraftClassListContent}
    </details>
  );

  // ── Top 5 Trending sidebar — mirrors the Draft Class positional-rankings
  // card above it (same row layout: badged square + name + school). The
  // trend's animation lives on the row's own box (a soft ambient glow, see
  // wd-*-box-soft) rather than on the name text. Hovering a row grows it in
  // place to reveal that player's trend Notes — same "the hovered box turns
  // into the popup" pattern as the flair/logo hero boxes above, rather than
  // a floating tooltip. ──
  const TrendingListContent = (
    <>
      {trendingTop5.map((t) => {
        const style = TREND_STYLE[(t.Trend || "").toString().trim().toLowerCase()];
        if (!style) return null;
        const isSelf = t.slug === player.Slug;
        const isHovered = hoveredTrendSlug === t.slug;
        const notesList = (t.Notes || "").toString().split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

        const rowContent = (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  width: "28px", height: "28px", borderRadius: "5px",
                  backgroundColor: style.badgeBg, border: `2px solid ${style.badgeBorder}`,
                  color: "#fff", fontSize: "12px", fontWeight: 900,
                }}
                title={style.label}
              >
                {style.icon}
              </div>
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ color: SITE_BLUE, fontWeight: 900, fontSize: "14px", lineHeight: 1.2 }}>
                  {t.First} {t.Last}
                </span>
                <span style={{ color: "#777", fontWeight: 700, fontSize: "12px", marginTop: "2px" }}>
                  {t.School || "—"}
                </span>
              </div>
            </div>
            {isHovered && (
              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${style.boxBorder}` }}>
                {notesList.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {notesList.map((s, i) => (
                      <div key={i} style={{ fontSize: "11px", fontWeight: 600, color: "#666", lineHeight: 1.4 }}>{s}</div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "#aaa", fontStyle: "italic" }}>No notes yet.</div>
                )}
              </div>
            )}
          </>
        );

        // The reserve wrapper keeps a stable min-height in normal flow so
        // neighboring rows don't jump when this one's box grows on hover.
        const rowBoxStyle = {
          display: "flex", flexDirection: "column", justifyContent: "center",
          padding: isHovered ? "10px 14px 12px" : "10px 14px",
          textDecoration: "none",
          background: isSelf ? "#fff8e6" : (isHovered ? "#fbfbfe" : "#fff"),
          borderLeft: `4px solid ${isSelf ? SITE_GOLD : style.badgeBorder}`,
          borderBottom: "1px solid #f0f0f0",
          position: "relative", zIndex: isHovered ? 5 : 1,
        };

        const handlers = {
          onMouseEnter: () => setHoveredTrendSlug(t.slug),
          onMouseLeave: () => setHoveredTrendSlug(null),
        };

        return (
          <div key={t.slug} style={{ minHeight: "54px" }}>
            {isSelf ? (
              <div className={style.softClass} style={rowBoxStyle} {...handlers}>{rowContent}</div>
            ) : (
              <Link to={`/player/${t.slug}`} className={style.softClass} style={rowBoxStyle} {...handlers}>
                {rowContent}
              </Link>
            )}
          </div>
        );
      })}
    </>
  );

  const showTrendingSidebar = trendingLoaded && trendingTop5.length > 0;

  const TrendingSidebarCard = showTrendingSidebar ? (
    <SidebarCard title="🔥 Trending" color1={SITE_BLUE} color2={SITE_GOLD}>
      {TrendingListContent}
    </SidebarCard>
  ) : null;

  const TrendingSidebarDropdown = showTrendingSidebar ? (
    <details style={{ border: `2px solid ${SITE_BLUE}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
      <summary style={{
        backgroundColor: SITE_BLUE,
        padding: "10px 14px",
        cursor: "pointer",
        listStyle: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        userSelect: "none",
      }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          🔥 Trending ▾
        </div>
        <span style={{ color: SITE_GOLD, fontWeight: 900, fontSize: "18px" }}>⬇</span>
      </summary>
      <div style={{ height: "4px", backgroundColor: SITE_GOLD }} />
      {TrendingListContent}
    </details>
  ) : null;

  // ── Videos sidebar — only rendered at all when the player has at least one
  // attached video; each row shows that video's per-slug title/thumb as a
  // full-width card (thumbnail on top, title overlaid in a gradient scrim). ──
  const VideosSidebar = (
    <SidebarCard title="Videos" color1={SITE_BLUE} color2={SITE_GOLD}>
      {playerVideos.slice(0, visibleVideoCount).map((v, i, arr) => (
        <a
          key={v.id}
          href={sanitizeUrl(v.video)}
          target="_blank"
          rel="noopener noreferrer"
          className="wd-video-card"
          style={{
            display: "block",
            position: "relative",
            textDecoration: "none",
            borderBottom: i < arr.length - 1 ? "1px solid #f0f0f0" : "none",
          }}
        >
          <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#111", overflow: "hidden" }}>
            {v.thumb ? (
              <img
                className="wd-video-thumb"
                src={sanitizeUrl(v.thumb)}
                alt={v.title || "Video thumbnail"}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.4s ease" }}
                referrerPolicy="no-referrer"
                onError={(e)=>{e.currentTarget.style.display="none";}}
                loading="lazy"
              />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "#fff", fontSize: "32px" }}>▶</span>
              </div>
            )}

            {/* gradient scrim so the title reads over any thumbnail */}
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.15) 55%, transparent 100%)", pointerEvents: "none" }} />

            {/* play button — scales/fades in on hover */}
            <div
              className="wd-video-play"
              style={{
                position: "absolute", top: "50%", left: "50%",
                transform: "translate(-50%, -50%) scale(0.8)",
                width: "48px", height: "48px", borderRadius: "50%",
                background: "rgba(255,255,255,0.95)",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: 0, transition: "opacity 0.25s ease, transform 0.25s ease",
                boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
              }}
            >
              <span style={{ color: color1, fontSize: "18px", marginLeft: "3px" }}>▶</span>
            </div>

            {v.title && (
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 12px" }}>
                <div className="font-black uppercase leading-tight" style={{ color: "#fff", fontSize: "13px", letterSpacing: "0.03em", textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}>
                  {v.title}
                </div>
              </div>
            )}
          </div>
        </a>
      ))}
      {visibleVideoCount < playerVideos.length && (
        <button
          onClick={() => setVisibleVideoCount((c) => c + 3)}
          style={{
            display: "block", width: "100%",
            padding: "10px 14px",
            background: SITE_BLUE, color: SITE_GOLD,
            border: "none", cursor: "pointer",
            fontWeight: 900, fontSize: "12px",
            textTransform: "uppercase", letterSpacing: "0.1em",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#003a7a"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = SITE_BLUE; }}
        >
          Show More Videos ▾
        </button>
      )}
    </SidebarCard>
  );

  // ── In The News sidebar ──
  const NewsSidebar = (
    <SidebarCard title="In The News" color1={SITE_BLUE} color2={SITE_GOLD}>
      {playerNews.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>No recent news.</div>
      ) : (
        playerNews.slice(0, SIDEBAR_NEWS_LIMIT).map((n, i) => (
          <Link key={n.slug || n.id} to={`/news/${n.slug}`}
            style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", textDecoration: "none", borderBottom: i < Math.min(playerNews.length, SIDEBAR_NEWS_LIMIT) - 1 ? "1px solid #f0f0f0" : "none" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f7f9fc"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
          >
            <div className="flex-shrink-0 rounded overflow-hidden" style={{ width: 36, border: `2px solid ${SITE_BLUE}`, background: "#fff", display: "flex", flexDirection: "column" }}>
              <div style={{ background: SITE_GOLD, lineHeight: 1, padding: "1px 0", textAlign: "center" }}>
                <span style={{ fontSize: "8px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  {n.publishedAt?.toDate?.().toLocaleDateString(undefined, { month: "short" })}
                </span>
              </div>
              <div style={{ padding: "3px 0 2px", textAlign: "center" }}>
                <span style={{ fontSize: "15px", fontWeight: 900, color: SITE_BLUE, lineHeight: 1, display: "block" }}>
                  {n.publishedAt?.toDate?.().toLocaleDateString(undefined, { day: "numeric" })}
                </span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="font-black uppercase rounded flex-shrink-0" style={{ backgroundColor: n.type === "article" ? SITE_GOLD : SITE_BLUE, color: "#fff", letterSpacing: "0.06em", fontSize: "7px", padding: "2px 5px", display: "inline-block", marginBottom: "3px" }}>
                {n.type === "article" ? "Article" : "News"}
              </span>
              <div className="font-black uppercase leading-tight" style={{ color: "#222", letterSpacing: "0.03em", fontSize: "12px" }}>{n.title}</div>
            </div>
          </Link>
        ))
      )}
    </SidebarCard>
  );

  return (
    <>
      <Helmet>
        <title>{`${player.First||""} ${player.Last||""} NFL Draft Scouting Report and Projection`}</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={`https://we-draft.com/player/${slug}`} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={`${player.First||""} ${player.Last||""} NFL Draft Scouting Report and Projection`} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:url" content={`https://we-draft.com/player/${slug}`} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={`${player.First||""} ${player.Last||""} NFL Draft Scouting Report and Projection`} />
        <meta name="twitter:description" content={metaDescription} />
      </Helmet>

      {adData && (
        <style>{`
          .wd-margin-ad:hover .wd-margin-ad-card {
            box-shadow: 0 8px 26px rgba(0,0,0,0.14);
            transform: translateY(-2px);
          }
          .wd-margin-ad:hover .wd-margin-ad-cta {
            background: #a10d24;
          }
          .wd-margin-ad:hover .wd-margin-ad-cta-team {
            filter: brightness(0.85);
          }
          .wd-team-btn:hover {
            border-color: #c8102e !important;
            box-shadow: 0 2px 8px rgba(200,16,46,0.25);
            transform: translateY(-1px);
          }
          .wd-team-btn:active {
            transform: translateY(0) scale(0.94);
          }
        `}</style>
      )}

      {playerVideos.length > 0 && (
        <style>{`
          .wd-video-card:hover .wd-video-thumb { transform: scale(1.08); }
          .wd-video-card:hover .wd-video-play { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        `}</style>
      )}

      {flairInfo && (
        <style>{`
          @keyframes wdFlairShine {
            0%   { left: -60%; }
            12%  { left: 130%; }
            100% { left: 130%; }
          }
          .wd-flair-shine { animation: wdFlairShine 4.5s ease-in-out infinite; }
        `}</style>
      )}

      {/* Trend glow/flicker keyframes — rendered unconditionally (not gated on
          this page's own trend) since the Top 5 Trending sidebar can show any
          of these three trend types regardless of which player's page you're
          on. On Fire uses faster, irregular keyframe stops (vs. the other
          tags' smooth 0/50/100 pulse) so it reads as a flicker rather than a
          heartbeat, plus its own icon jitter/scale animation on top so the
          🔥 itself reads as an actual flickering flame. */}
      <style>{`
        @keyframes wdBreakoutTagGlow {
          0%, 100% { box-shadow: 0 0 6px 1px rgba(143,216,255,0.45); }
          50%      { box-shadow: 0 0 12px 3px rgba(143,216,255,0.85); }
        }
        .wd-breakout-tag { animation: wdBreakoutTagGlow 2.4s ease-in-out infinite; }

        @keyframes wdTrendUpTagGlow {
          0%, 100% { box-shadow: 0 0 6px 1px rgba(74,222,128,0.45); }
          50%      { box-shadow: 0 0 12px 3px rgba(74,222,128,0.85); }
        }
        .wd-trendup-tag { animation: wdTrendUpTagGlow 2.4s ease-in-out infinite; }

        @keyframes wdOnFireTagGlow {
          0%   { box-shadow: 0 0 6px 1px rgba(255,120,0,0.5), 0 0 16px 4px rgba(255,60,0,0.25); }
          20%  { box-shadow: 0 0 10px 3px rgba(255,180,0,0.65), 0 0 20px 6px rgba(255,80,0,0.35); }
          40%  { box-shadow: 0 0 7px 2px rgba(255,100,0,0.55), 0 0 14px 3px rgba(255,50,0,0.3); }
          60%  { box-shadow: 0 0 13px 4px rgba(255,150,0,0.75), 0 0 22px 7px rgba(255,70,0,0.4); }
          80%  { box-shadow: 0 0 8px 2px rgba(255,110,0,0.5), 0 0 16px 4px rgba(255,60,0,0.3); }
          100% { box-shadow: 0 0 6px 1px rgba(255,120,0,0.5), 0 0 16px 4px rgba(255,60,0,0.25); }
        }
        .wd-onfire-tag { animation: wdOnFireTagGlow 1.4s ease-in-out infinite; }
        @keyframes wdOnFireIconFlicker {
          0%, 100% { transform: scale(1) rotate(0deg); filter: drop-shadow(0 0 3px rgba(255,140,0,0.9)); }
          25%      { transform: scale(1.08) rotate(-3deg); filter: drop-shadow(0 0 6px rgba(255,90,0,1)); }
          50%      { transform: scale(0.96) rotate(2deg); filter: drop-shadow(0 0 4px rgba(255,180,0,0.85)); }
          75%      { transform: scale(1.05) rotate(-2deg); filter: drop-shadow(0 0 7px rgba(255,60,0,1)); }
        }
        .wd-onfire-icon { display:inline-block; animation: wdOnFireIconFlicker 0.9s ease-in-out infinite; }

        /* Top 5 Trending sidebar — same three trends, much quieter: a slow,
           smooth pulse (no flicker, no icon jitter) on each row's own box
           rather than the header tags' bolder glow. */
        @keyframes wdTrendUpBoxSoft {
          0%, 100% { box-shadow: 0 0 0 1px rgba(74,222,128,0.16), 0 0 4px 1px rgba(74,222,128,0.16); }
          50%      { box-shadow: 0 0 0 1px rgba(74,222,128,0.28), 0 0 7px 2px rgba(74,222,128,0.3); }
        }
        .wd-trendup-box-soft { animation: wdTrendUpBoxSoft 3.2s ease-in-out infinite; }
        @keyframes wdBreakoutBoxSoft {
          0%, 100% { box-shadow: 0 0 0 1px rgba(143,216,255,0.16), 0 0 4px 1px rgba(143,216,255,0.16); }
          50%      { box-shadow: 0 0 0 1px rgba(143,216,255,0.28), 0 0 7px 2px rgba(143,216,255,0.3); }
        }
        .wd-breakout-box-soft { animation: wdBreakoutBoxSoft 3.2s ease-in-out infinite; }
        @keyframes wdOnFireBoxSoft {
          0%, 100% { box-shadow: 0 0 0 1px rgba(255,140,0,0.16), 0 0 4px 1px rgba(255,90,0,0.16); }
          50%      { box-shadow: 0 0 0 1px rgba(255,140,0,0.3), 0 0 8px 2px rgba(255,90,0,0.32); }
        }
        .wd-onfire-box-soft { animation: wdOnFireBoxSoft 3.2s ease-in-out infinite; }
      `}</style>

      {showBreakoutAnim && (
        <>
          <style>{`
            @keyframes wdVoltOverlayFade {
              0%   { opacity: 0; }
              8%   { opacity: 1; }
              82%  { opacity: 1; }
              100% { opacity: 0; }
            }
            @keyframes wdVoltTextFlicker {
              0%   { opacity: 0; filter: brightness(3) blur(3px); transform: scale(0.92); }
              4%   { opacity: 1; }
              7%   { opacity: 0.15; }
              10%  { opacity: 1; }
              13%  { opacity: 0.25; }
              16%  { opacity: 1; filter: brightness(1.7) blur(0px); transform: scale(1.02); }
              20%  { transform: scale(1); filter: brightness(1); }
              82%  { opacity: 1; }
              100% { opacity: 0; }
            }
            @keyframes wdBoltFlashA {
              0%, 100% { opacity: 0; }
              5% { opacity: 1; }
              9% { opacity: 0; }
              13% { opacity: 0.8; }
              17% { opacity: 0; }
            }
            @keyframes wdBoltFlashB {
              0%, 100% { opacity: 0; }
              7% { opacity: 0.9; }
              11% { opacity: 0; }
              15% { opacity: 1; }
              19% { opacity: 0; }
            }
          `}</style>
          <div
            style={{
              position:"fixed", inset:0, zIndex:200,
              display:"flex", alignItems:"center", justifyContent:"center",
              pointerEvents:"none", overflow:"hidden",
              background:"radial-gradient(circle at center, rgba(35,42,50,0.78), rgba(4,6,8,0.9))",
              animation:"wdVoltOverlayFade 2.4s ease forwards",
            }}
          >
            {/* electric bolt streaks */}
            <div
              style={{
                position:"absolute", top:"20%", left:"-10%", width:"120%", height:"3px",
                background:"linear-gradient(90deg, transparent, #bfe8ff, #ffffff, #7fd0ff, transparent)",
                boxShadow:"0 0 14px 2px rgba(140,220,255,0.9)",
                transform:"rotate(-8deg)",
                animation:"wdBoltFlashA 2.4s ease forwards",
              }}
            />
            <div
              style={{
                position:"absolute", bottom:"24%", left:"-10%", width:"120%", height:"2px",
                background:"linear-gradient(90deg, transparent, #9fdcff, #ffffff, #6fc4ff, transparent)",
                boxShadow:"0 0 12px 2px rgba(120,200,255,0.85)",
                transform:"rotate(6deg)",
                animation:"wdBoltFlashB 2.4s ease forwards",
              }}
            />
            <div
              style={{
                position:"relative",
                fontSize:"clamp(38px,10vw,110px)",
                fontWeight:900,
                textTransform:"uppercase",
                letterSpacing:"0.1em",
                textAlign:"center",
                backgroundImage:"linear-gradient(180deg, #ffffff 0%, #d6dee6 30%, #8b97a3 52%, #c7d1da 70%, #ffffff 100%)",
                WebkitBackgroundClip:"text",
                backgroundClip:"text",
                color:"transparent",
                WebkitTextFillColor:"transparent",
                textShadow:"0 0 18px rgba(130,205,255,0.85), 0 0 46px rgba(90,170,255,0.55)",
                animation:"wdVoltTextFlicker 2.4s ease forwards",
              }}
            >
              Breakout
            </div>
          </div>
        </>
      )}

      <div
        ref={mainGridRef}
        className="mx-auto pb-40"
        style={
          isMobile
            ? { padding: "10px 10px 160px", display: "flex", flexDirection: "column", gap: "24px", opacity:pageVisible?1:0, transform:pageVisible?"translateY(0)":"translateY(8px)", transition:"opacity 0.28s ease, transform 0.28s ease" }
            : { maxWidth: "1600px", margin: "0 auto", padding: "24px 60px 160px", display: "grid", gridTemplateColumns: "260px minmax(0, 800px) 260px", gap: "18px", alignItems: "start", justifyContent: "center", opacity:pageVisible?1:0, transform:pageVisible?"translateY(0)":"translateY(8px)", transition:"opacity 0.28s ease, transform 0.28s ease" }
        }
      >

        {/* ===== LEFT COLUMN: Trending + Draft Class ===== */}
        {isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {TrendingSidebarDropdown}
            {DraftClassDropdown}
          </div>
        ) : (
          <div style={{ position: "sticky", top: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
            {TrendingSidebarCard}
            {DraftClassList}
          </div>
        )}

        {/* ===== MAIN COLUMN ===== */}
        <div>

        {/* ===== HERO CARD ===== */}
        <div className="mb-6 rounded-lg overflow-hidden" style={{ border: `3px solid ${color1}` }}>
          <div className="flex items-center justify-between" style={{ backgroundColor:color1, padding:isMobile?"10px 12px":"12px 20px", flexWrap:"wrap", rowGap:"8px" }}>
            <button onClick={()=>navigate(-1)} className="text-white font-extrabold transition"
              style={{ border:"2px solid #fff", background:"rgba(255,255,255,0.12)", fontSize:isMobile?"14px":"16px", padding:isMobile?"8px 16px":"10px 22px", borderRadius:"8px", cursor:"pointer", letterSpacing:"0.04em" }}>
              ← Back
            </button>

            <div className="flex items-center" style={{ gap:isMobile?"16px":"24px" }}>
              <button
                onClick={handleToggleLike}
                title="Like"
                className="transition"
                style={{
                  display:"flex", flexDirection:"column", alignItems:"center", gap:"3px",
                  background:"none", border:"none", cursor:"pointer",
                }}
              >
                <span style={{
                  fontSize:isMobile?"32px":"42px", lineHeight:1,
                  color: myReaction.liked ? "#ff4d6d" : "#fff",
                  WebkitTextStroke: myReaction.liked ? "1.5px #fff" : "0px transparent",
                }}>♥</span>
                <span style={{ fontSize:isMobile?"12px":"14px", fontWeight:900, color:"#fff" }}>{reactionCounts.likes}</span>
              </button>
              <button
                onClick={()=>handleVote("up")}
                title="Upvote"
                className="transition"
                style={{
                  display:"flex", flexDirection:"column", alignItems:"center", gap:"3px",
                  background:"none", border:"none", cursor:"pointer",
                }}
              >
                <span style={{
                  fontSize:isMobile?"30px":"40px", lineHeight:1,
                  color: myReaction.vote==="up" ? "#4ade80" : "#fff",
                  WebkitTextStroke: myReaction.vote==="up" ? "1.5px #fff" : "0px transparent",
                }}>▲</span>
                <span style={{ fontSize:isMobile?"12px":"14px", fontWeight:900, color:"#fff" }}>{reactionCounts.up}</span>
              </button>
              <button
                onClick={()=>handleVote("down")}
                title="Downvote"
                className="transition"
                style={{
                  display:"flex", flexDirection:"column", alignItems:"center", gap:"3px",
                  background:"none", border:"none", cursor:"pointer",
                }}
              >
                <span style={{
                  fontSize:isMobile?"30px":"40px", lineHeight:1,
                  color: myReaction.vote==="down" ? "#f87171" : "#fff",
                  WebkitTextStroke: myReaction.vote==="down" ? "1.5px #fff" : "0px transparent",
                }}>▼</span>
                <span style={{ fontSize:isMobile?"12px":"14px", fontWeight:900, color:"#fff" }}>{reactionCounts.down}</span>
              </button>
            </div>

            <div className="flex gap-2">
              {player.Link && String(player.Eligible) === "2026" && (
                <button onClick={()=>{ const url=Array.isArray(player.Link)?player.Link[0]:player.Link; window.open(url,"_blank","noopener,noreferrer"); }}
                  className="text-white font-extrabold rounded-full transition hover:opacity-80"
                  style={{ border:"2px solid #fff", background:"rgba(255,255,255,0.12)", fontSize:isMobile?"14px":"16px", padding:isMobile?"8px 16px":"10px 22px" }}>
                  Film
                </button>
              )}
              {!draftedBy && (
                <button onClick={()=>evaluationFormRef.current?.scrollIntoView({behavior:"smooth",block:"start"})}
                  className="font-extrabold rounded-full transition hover:opacity-90"
                  style={{ backgroundColor:color2, border:"2px solid #fff", color:"#fff", fontSize:isMobile?"14px":"16px", padding:isMobile?"8px 16px":"10px 22px", fontWeight:900 }}>
                  Evaluate
                </button>
              )}
            </div>
          </div>

          <div className="bg-white flex items-center" style={{ gap:isMobile?"8px":"16px", padding:isMobile?"12px 10px 8px":"20px 24px 10px" }}>
            <div className="flex-shrink-0" style={{ position:"relative", width:isMobile?60:112, height:isMobile?60:112 }}>
              <div
                className="flex items-center justify-center"
                style={{
                  position:"absolute", top:0, left:0, overflow:"hidden", boxSizing:"border-box",
                  width: showLeftBoxTip ? (isMobile?150:190) : (isMobile?60:112),
                  height: showLeftBoxTip ? (isMobile?90:112) : (isMobile?60:112),
                  background:"#f8f8f8", border:`2px solid ${color2}`, borderRadius:"8px",
                  boxShadow: showLeftBoxTip ? "0 14px 30px rgba(0,0,0,0.16)" : "none",
                  zIndex: showLeftBoxTip ? 50 : 1,
                  transition:"width 0.22s ease, height 0.22s ease, box-shadow 0.22s ease",
                }}
                onMouseEnter={() => branding?.logo1 && !draftedBy && setShowLeftBoxTip(true)}
                onMouseLeave={() => setShowLeftBoxTip(false)}
              >
                {draftedBy ? (
                  branding?.nflLogo ? <img src={sanitizeUrl(branding.nflLogo)} alt="NFL" style={{ height:isMobile?50:96, objectFit:"contain" }} /> : null
                ) : branding?.logo1 ? (
                  <Link
                    to={`/team/${teamSlug}`}
                    className="flex items-center justify-center w-full h-full"
                    style={{ flexDirection:"column", gap: showLeftBoxTip ? "8px" : 0 }}
                  >
                    <img
                      src={sanitizeUrl(showLeftBoxTip && branding.wordmark ? branding.wordmark : branding.logo1)} alt={player.School}
                      style={{ height: showLeftBoxTip ? (isMobile?36:44) : (isMobile?50:96), objectFit:"contain", transition:"height 0.22s ease" }}
                      referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}} loading="lazy"
                    />
                    {showLeftBoxTip && (
                      <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                        <span style={{ fontSize:"12px" }}>🔗</span>
                        <span style={{ fontSize:"11px", fontWeight:900, textTransform:"uppercase", letterSpacing:"0.06em", color:color1, whiteSpace:"nowrap" }}>
                          Team Page
                        </span>
                      </div>
                    )}
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="flex-1 text-center">
              <h1 className="font-black uppercase leading-none" style={{ fontSize:isMobile?"clamp(20px,6vw,30px)":"clamp(36px,5vw,58px)", color:color1, letterSpacing:"0.02em" }}>
                <div>{player.First}</div>
                <div style={{ marginTop:isMobile?"2px":"4px" }}>{player.Last}</div>
              </h1>
              <div className="flex items-center justify-center flex-wrap mt-2" style={{ gap:isMobile?"6px":"10px" }}>
                <span className="font-extrabold rounded-full" style={{ backgroundColor:color1, color:"#fff", letterSpacing:"0.05em", fontSize:isMobile?"11px":"17px", padding:isMobile?"2px 8px":"3px 16px" }}>
                  {player.Position}
                </span>
                <span style={{ color:"#ccc" }}>·</span>
                <span onClick={()=>navigate(`/team/${teamSlug}`)} className="font-extrabold hover:underline cursor-pointer" style={{ color:color1, fontSize:isMobile?"12px":"19px" }}>
                  {player.School}
                </span>
                <span style={{ color:"#ccc" }}>·</span>
                <span className="font-bold" style={{ color:"#666", fontSize:isMobile?"12px":"19px" }}>{formatEligible(player.Eligible)}</span>
                {isTrendingUp && (
                  <>
                    <span style={{ color:"#ccc" }}>·</span>
                    <div
                      style={{ position:"relative", display:"inline-block" }}
                      onMouseEnter={() => setShowTrendUpTip(true)}
                      onMouseLeave={() => setShowTrendUpTip(false)}
                      onClick={() => setShowTrendUpTip((v) => !v)}
                    >
                      <span
                        className="font-extrabold rounded-full wd-trendup-tag"
                        style={{
                          display:"inline-flex", alignItems:"center", gap:"5px",
                          backgroundImage:"linear-gradient(135deg, #14532d, #16a34a)",
                          border:"1px solid #4ade80",
                          color:"#eafff0",
                          letterSpacing:"0.06em",
                          fontSize:isMobile?"11px":"16px",
                          padding:isMobile?"2px 10px":"3px 15px",
                          textTransform:"uppercase",
                          cursor:"pointer",
                        }}
                      >
                        ▲ Trending Up
                      </span>
                      {showTrendUpTip && (
                        <div
                          style={{
                            position:"absolute",
                            top:"calc(100% + 14px)",
                            left:"50%",
                            transform:"translateX(-50%)",
                            width:isMobile?"220px":"264px",
                            backgroundImage:"linear-gradient(135deg, #0f2b1a, #1e4028)",
                            border:"1px solid rgba(74,222,128,0.55)",
                            borderRadius:"14px",
                            padding:"14px 16px",
                            boxShadow:"0 16px 36px rgba(0,0,0,0.4), 0 0 0 1px rgba(74,222,128,0.08)",
                            zIndex:60,
                            textAlign:"left",
                            pointerEvents:"none",
                          }}
                        >
                          <div style={{ position:"absolute", bottom:"100%", left:"50%", transform:"translateX(-50%) rotate(45deg)", width:"13px", height:"13px", background:"#1e4028", border:"1px solid rgba(74,222,128,0.55)", borderRadius:"2px" }} />
                          <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"7px" }}>
                            <span style={{ fontSize:"12px" }}>▲</span>
                            <div style={{
                              fontSize:isMobile?"11px":"12px",
                              fontWeight:900,
                              textTransform:"uppercase",
                              letterSpacing:"0.06em",
                              color:"#eafff0",
                            }}>
                              {`${player.First||""} ${player.Last||""}`.trim()} Trending Up
                            </div>
                          </div>
                          <div style={{ height:"1px", background:"linear-gradient(90deg, rgba(74,222,128,0.6), transparent)", marginBottom:"8px" }} />
                          {trendNotesList.length > 0 && (
                            <div style={{ display:"flex", flexDirection:"column", gap:"5px" }}>
                              {trendNotesList.map((s, i) => (
                                <div key={i} style={{ fontSize:isMobile?"11px":"12px", fontWeight:600, color:"#d4f5df", lineHeight:1.4 }}>
                                  {s}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
                {isBreakoutTrend && (
                  <>
                    <span style={{ color:"#ccc" }}>·</span>
                    <div
                      style={{ position:"relative", display:"inline-block" }}
                      onMouseEnter={() => setShowBreakoutTip(true)}
                      onMouseLeave={() => setShowBreakoutTip(false)}
                      onClick={() => setShowBreakoutTip((v) => !v)}
                    >
                      <span
                        className="font-extrabold rounded-full wd-breakout-tag"
                        style={{
                          display:"inline-flex", alignItems:"center", gap:"5px",
                          backgroundImage:"linear-gradient(135deg, #2c333b, #4a535e)",
                          border:"1px solid #8fd8ff",
                          color:"#eaf6ff",
                          letterSpacing:"0.06em",
                          fontSize:isMobile?"11px":"16px",
                          padding:isMobile?"2px 10px":"3px 15px",
                          textTransform:"uppercase",
                          cursor:"pointer",
                        }}
                      >
                        ⚡ Breakout
                      </span>
                      {showBreakoutTip && (
                        <div
                          style={{
                            position:"absolute",
                            top:"calc(100% + 14px)",
                            left:"50%",
                            transform:"translateX(-50%)",
                            width:isMobile?"220px":"264px",
                            backgroundImage:"linear-gradient(135deg, #1c2128, #2f3742)",
                            border:"1px solid rgba(143,216,255,0.55)",
                            borderRadius:"14px",
                            padding:"14px 16px",
                            boxShadow:"0 16px 36px rgba(0,0,0,0.4), 0 0 0 1px rgba(143,216,255,0.08)",
                            zIndex:60,
                            textAlign:"left",
                            pointerEvents:"none",
                          }}
                        >
                          <div style={{ position:"absolute", bottom:"100%", left:"50%", transform:"translateX(-50%) rotate(45deg)", width:"13px", height:"13px", background:"#2f3742", border:"1px solid rgba(143,216,255,0.55)", borderRadius:"2px" }} />
                          <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"7px" }}>
                            <span style={{ fontSize:"12px" }}>⚡</span>
                            <div style={{
                              fontSize:isMobile?"11px":"12px",
                              fontWeight:900,
                              textTransform:"uppercase",
                              letterSpacing:"0.06em",
                              color:"#eaf6ff",
                            }}>
                              {`${player.First||""} ${player.Last||""}`.trim()} Breakout Performance
                            </div>
                          </div>
                          <div style={{ height:"1px", background:"linear-gradient(90deg, rgba(143,216,255,0.6), transparent)", marginBottom:"8px" }} />
                          {breakoutStats.length > 0 && (
                            <div style={{ display:"flex", flexDirection:"column", gap:"5px" }}>
                              {breakoutStats.map((s, i) => (
                                <div key={i} style={{ fontSize:isMobile?"11px":"12px", fontWeight:600, color:"#cfe9ff", lineHeight:1.4 }}>
                                  {s}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
                {isOnFireTrend && (
                  <>
                    <span style={{ color:"#ccc" }}>·</span>
                    <div
                      style={{ position:"relative", display:"inline-block" }}
                      onMouseEnter={() => setShowOnFireTip(true)}
                      onMouseLeave={() => setShowOnFireTip(false)}
                      onClick={() => setShowOnFireTip((v) => !v)}
                    >
                      <span
                        className="font-extrabold rounded-full wd-onfire-tag"
                        style={{
                          display:"inline-flex", alignItems:"center", gap:"5px",
                          backgroundImage:"linear-gradient(135deg, #7a1f00, #ff6a00)",
                          border:"1px solid #ffb347",
                          color:"#fff3e6",
                          letterSpacing:"0.06em",
                          fontSize:isMobile?"11px":"16px",
                          padding:isMobile?"2px 10px":"3px 15px",
                          textTransform:"uppercase",
                          cursor:"pointer",
                        }}
                      >
                        <span className="wd-onfire-icon">🔥</span> On Fire
                      </span>
                      {showOnFireTip && (
                        <div
                          style={{
                            position:"absolute",
                            top:"calc(100% + 14px)",
                            left:"50%",
                            transform:"translateX(-50%)",
                            width:isMobile?"220px":"264px",
                            backgroundImage:"linear-gradient(135deg, #3a1400, #6b2800)",
                            border:"1px solid rgba(255,179,71,0.55)",
                            borderRadius:"14px",
                            padding:"14px 16px",
                            boxShadow:"0 16px 36px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,179,71,0.08)",
                            zIndex:60,
                            textAlign:"left",
                            pointerEvents:"none",
                          }}
                        >
                          <div style={{ position:"absolute", bottom:"100%", left:"50%", transform:"translateX(-50%) rotate(45deg)", width:"13px", height:"13px", background:"#6b2800", border:"1px solid rgba(255,179,71,0.55)", borderRadius:"2px" }} />
                          <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"7px" }}>
                            <span style={{ fontSize:"12px" }}>🔥</span>
                            <div style={{
                              fontSize:isMobile?"11px":"12px",
                              fontWeight:900,
                              textTransform:"uppercase",
                              letterSpacing:"0.06em",
                              color:"#fff3e6",
                            }}>
                              {`${player.First||""} ${player.Last||""}`.trim()} On Fire
                            </div>
                          </div>
                          <div style={{ height:"1px", background:"linear-gradient(90deg, rgba(255,179,71,0.6), transparent)", marginBottom:"8px" }} />
                          {trendNotesList.length > 0 && (
                            <div style={{ display:"flex", flexDirection:"column", gap:"5px" }}>
                              {trendNotesList.map((s, i) => (
                                <div key={i} style={{ fontSize:isMobile?"11px":"12px", fontWeight:600, color:"#ffe0c2", lineHeight:1.4 }}>
                                  {s}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
              {draftedBy && draftInfo && (
                <div className="flex items-center justify-center gap-3 mt-2">
                  <div style={{ display:"flex", gap:"6px" }}>
                    <div style={{
                      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                      width:"44px", height:"44px", borderRadius:"8px",
                      backgroundColor:color1, border:`2px solid ${color2}`,
                    }}>
                      <span style={{ fontSize:"8px", fontWeight:800, color:"rgba(255,255,255,0.7)", textTransform:"uppercase", letterSpacing:"0.06em", lineHeight:1 }}>Rd</span>
                      <span style={{ fontSize:"20px", fontWeight:900, color:"#fff", lineHeight:1.1, marginTop:"2px" }}>{draftInfo.round}</span>
                    </div>
                    <div style={{
                      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                      width:"44px", height:"44px", borderRadius:"8px",
                      backgroundColor:"#fff", border:`2px solid ${color1}`,
                    }}>
                      <span style={{ fontSize:"20px", fontWeight:900, color:color1, lineHeight:1.1 }}>{draftInfo.pick}</span>
                      <span style={{ fontSize:"8px", fontWeight:800, color:"#999", textTransform:"uppercase", letterSpacing:"0.06em", lineHeight:1, marginTop:"2px" }}>Pick</span>
                    </div>
                  </div>
                  <div className="text-left">
                    <div style={{ fontSize:"10px", fontWeight:800, color:"#999", textTransform:"uppercase", letterSpacing:"0.1em" }}>Selected by</div>
                    <span onClick={()=>navigate(`/nfl/${draftedBy.toLowerCase()}`)} className="font-black uppercase cursor-pointer hover:underline" style={{ fontSize:isMobile?"13px":"18px", color:color1, letterSpacing:"0.04em" }}>
                      {teamNameFromAbbr(draftedBy)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-shrink-0" style={{ position:"relative", width:isMobile?60:112, height:isMobile?60:112 }}>
              <div
                className="flex items-center justify-center"
                style={{
                  position:"absolute", top:0, right:0, overflow:"hidden", boxSizing:"border-box",
                  width: showRightBoxTip ? (isMobile?200:250) : (isMobile?60:112),
                  height: showRightBoxTip ? "auto" : (isMobile?60:112),
                  minHeight: isMobile?60:112,
                  background: flairInfo
                    ? `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.95), #f2f4f6 55%, #e9edf0 100%)`
                    : "#f8f8f8",
                  border:`2px solid ${flairInfo ? flairInfo.stroke : (draftedBy ? color1 : branding?.logo2 ? color1 : "#eee")}`,
                  borderRadius:"8px",
                  boxShadow: showRightBoxTip ? "0 14px 30px rgba(0,0,0,0.16)" : "none",
                  zIndex: showRightBoxTip ? 50 : 1,
                  flexDirection:"column",
                  alignItems: showRightBoxTip && flairInfo ? "flex-start" : "center",
                  justifyContent: showRightBoxTip && flairInfo ? "flex-start" : "center",
                  textAlign: showRightBoxTip && flairInfo ? "left" : "center",
                  padding: showRightBoxTip && flairInfo ? "12px 14px" : 0,
                  transition:"width 0.22s ease, height 0.22s ease, box-shadow 0.22s ease",
                }}
                onMouseEnter={() => (flairInfo || (draftedBy ? branding?.cfbLogo : branding?.logo2)) && setShowRightBoxTip(true)}
                onMouseLeave={() => setShowRightBoxTip(false)}
                onClick={() => flairInfo && setShowRightBoxTip((v) => !v)}
              >
                {flairInfo ? (
                  showRightBoxTip ? (
                    <>
                      <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:"7px", rowGap:"5px", marginBottom:"7px", width:"100%" }}>
                        <span style={{ width:"8px", height:"8px", borderRadius:"50%", background:flairInfo.stroke, flexShrink:0 }} />
                        <div
                          style={{
                            fontSize:isMobile?"11px":"12px",
                            fontWeight:900,
                            textTransform:"uppercase",
                            letterSpacing:"0.06em",
                            color:flairInfo.stroke,
                          }}
                        >
                          {player.Flair}
                        </div>
                        {/* Outlined (not solid-fill) so the tag stays readable
                            regardless of how light the flair's own accent color
                            is — a white-on-bright-yellow solid fill was
                            unreadable for "Developmental". */}
                        {flairInfo.tag && (
                          <span style={{
                            fontSize:"8px", fontWeight:900, textTransform:"uppercase", letterSpacing:"0.05em",
                            color:flairInfo.stroke, background:"#fff", border:`1px solid ${flairInfo.stroke}`,
                            padding:"2px 6px", borderRadius:"20px", whiteSpace:"nowrap", flexShrink:0,
                          }}>
                            {flairInfo.tag}
                          </span>
                        )}
                      </div>
                      <div style={{ height:"1px", background:`linear-gradient(90deg, ${flairInfo.stroke}66, transparent)`, marginBottom:"8px", width:"100%" }} />
                      <div style={{ fontSize:isMobile?"11px":"12px", fontWeight:600, color:"#555", lineHeight:1.5 }}>
                        {flairInfo.desc || "Description coming soon."}
                      </div>
                    </>
                  ) : (
                    <div style={{ position:"relative", width:"100%", height:"100%", overflow:"hidden", borderRadius:"6px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <img
                        src={flairInfo.img}
                        alt={player.Flair}
                        style={{
                          height:isMobile?50:96, objectFit:"contain", cursor:"pointer",
                          filter:"drop-shadow(0 3px 5px rgba(0,0,0,0.18))",
                          position:"relative", zIndex:1,
                        }}
                      />
                      {/* glossy sheen sweep — gives the badge a bit of life instead of sitting flat */}
                      <div
                        className="wd-flair-shine"
                        style={{
                          position:"absolute", top:0, left:"-60%", width:"40%", height:"100%",
                          background:"linear-gradient(115deg, transparent, rgba(255,255,255,0.65), transparent)",
                          transform:"skewX(-20deg)",
                          pointerEvents:"none",
                          zIndex:2,
                        }}
                      />
                    </div>
                  )
                ) : draftedBy ? (
                  branding?.cfbLogo ? (
                    <Link
                      to={`/team/${teamSlug}`}
                      className="flex items-center justify-center w-full h-full"
                      style={{ flexDirection:"column", gap: showRightBoxTip ? "8px" : 0 }}
                    >
                      <img
                        src={sanitizeUrl(showRightBoxTip && branding.cfbWordmark ? branding.cfbWordmark : branding.cfbLogo)} alt="College"
                        style={{ height: showRightBoxTip ? (isMobile?32:40) : (isMobile?42:88), objectFit:"contain", transition:"height 0.22s ease" }}
                      />
                      {showRightBoxTip && (
                        <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                          <span style={{ fontSize:"12px" }}>🔗</span>
                          <span style={{ fontSize:"11px", fontWeight:900, textTransform:"uppercase", letterSpacing:"0.06em", color:color1, whiteSpace:"nowrap" }}>
                            Team Page
                          </span>
                        </div>
                      )}
                    </Link>
                  ) : null
                ) : branding?.logo2 ? (
                  <Link
                    to={`/team/${teamSlug}`}
                    className="flex items-center justify-center w-full h-full"
                    style={{ flexDirection:"column", gap: showRightBoxTip ? "8px" : 0 }}
                  >
                    <img
                      src={sanitizeUrl(branding.logo2)} alt=""
                      style={{ height: showRightBoxTip ? (isMobile?36:44) : (isMobile?50:96), objectFit:"contain", transition:"height 0.22s ease" }}
                      referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}} loading="lazy"
                    />
                    {showRightBoxTip && (
                      <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                        <span style={{ fontSize:"12px" }}>🔗</span>
                        <span style={{ fontSize:"11px", fontWeight:900, textTransform:"uppercase", letterSpacing:"0.06em", color:color1, whiteSpace:"nowrap" }}>
                          Team Page
                        </span>
                      </div>
                    )}
                  </Link>
                ) : null}
              </div>
            </div>
          </div>

          {physicalMeasurements.length > 0 && (
            <div className="bg-white" style={{ padding:isMobile?"6px 10px 12px":"8px 24px 16px" }}>
              {isMobile ? (
                <div style={{ display:"flex", flexWrap:"wrap", gap:"5px", justifyContent:"center" }}>
                  <div style={{ width:"100%", fontSize:"12px", fontWeight:900, letterSpacing:"0.1em", textTransform:"uppercase", color:"#666", textAlign:"center", marginBottom:"4px" }}>Physical</div>
                  {physicalMeasurements.map((m) => <StatPill key={m.label} val={m.val} label={m.label} />)}
                  {hasAthletic && <>
                    <div style={{ width:"100%", fontSize:"12px", fontWeight:900, letterSpacing:"0.1em", textTransform:"uppercase", color:"#666", textAlign:"center", marginTop:"8px", marginBottom:"4px" }}>Athletic Testing</div>
                    {athleticMeasurements.map((m) => <StatPill key={m.label} val={m.val} label={m.label} />)}
                  </>}
                </div>
              ) : (
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"center", gap:0 }}>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                    <GroupLabel>Physical</GroupLabel>
                    <div style={{ display:"flex", gap:"7px", flexWrap:"wrap", justifyContent:"center" }}>
                      {physicalMeasurements.map((m) => <StatPill key={m.label} val={m.val} label={m.label} />)}
                    </div>
                  </div>
                  {hasAthletic && <div style={{ width:"1px", background:"#e0e0e0", alignSelf:"stretch", margin:"18px 20px 0", flexShrink:0 }} />}
                  {hasAthletic && (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                      <GroupLabel>Athletic Testing</GroupLabel>
                      <div style={{ display:"flex", gap:"7px", flexWrap:"wrap", justifyContent:"center" }}>
                        {athleticMeasurements.map((m) => <StatPill key={m.label} val={m.val} label={m.label} />)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        {/* ===== Season Stats ===== */}
        {playerStats && (() => {
          const pos = (player.Position || "").toUpperCase();
          const s = playerStats;
          const n = (v) => (v !== undefined && v !== null && v !== "") ? String(v) : null;
          const formatNum = (v) => { const n = Number(v); if (isNaN(n)) return v; return n.toLocaleString(); };
          let statPills = [];
          if (pos === "QB") {
            const comp = n(s.PassComp), att = n(s.PassAtt), yds = n(s.PassYds), td = n(s.PassTD), ints = n(s.Int), ryds = n(s.RushYds), rtd = n(s.RushTD);
            const pct = (comp && att && Number(att) > 0) ? Math.round((Number(comp) / Number(att)) * 100) + "%" : null;
            if (comp && att) statPills.push({ val: `${formatNum(comp)}/${formatNum(att)}${pct ? ` (${pct})` : ""}`, label: "Comp/Att" });
            if (yds) statPills.push({ val: formatNum(yds), label: "Pass Yds" });
            if (td) statPills.push({ val: formatNum(td), label: "Pass TD" });
            if (ints) statPills.push({ val: formatNum(ints), label: "Int" });
            if (ryds) statPills.push({ val: formatNum(ryds), label: "Rush Yds" });
            if (rtd) statPills.push({ val: formatNum(rtd), label: "Rush TD" });
          } else if (pos === "RB") {
            const att = n(s.RushAtt), yds = n(s.RushYds), td = n(s.RushTD), rec = n(s.Rec), ryds = n(s.RecYds), rtd = n(s.RecTD);
            const ypc = (att && yds && Number(att) > 0) ? (Number(yds) / Number(att)).toFixed(1) : null;
            if (yds) statPills.push({ val: `${formatNum(yds)}${ypc ? ` (${ypc})` : ""}`, label: "Rush Yds" });
            if (td) statPills.push({ val: formatNum(td), label: "Rush TD" });
            if (rec) statPills.push({ val: formatNum(rec), label: "Rec" });
            if (ryds) statPills.push({ val: formatNum(ryds), label: "Rec Yds" });
            if (rtd) statPills.push({ val: formatNum(rtd), label: "Rec TD" });
          } else if (pos === "WR" || pos === "TE") {
            const rec = n(s.Rec), yds = n(s.RecYds), td = n(s.RecTD);
            if (rec) statPills.push({ val: formatNum(rec), label: "Rec" });
            if (yds) statPills.push({ val: formatNum(yds), label: "Rec Yds" });
            if (td) statPills.push({ val: formatNum(td), label: "Rec TD" });
          } else if (pos === "DL" || pos === "EDGE" || pos === "DE" || pos === "DT") {
            const tkl = n(s.Tkl), tfl = n(s.TFL), sk = n(s.Sk), ff = n(s.FF);
            if (tkl) statPills.push({ val: formatNum(tkl), label: "Tkl" });
            if (tfl) statPills.push({ val: formatNum(tfl), label: "TFL" });
            if (sk) statPills.push({ val: formatNum(sk), label: "Sacks" });
            if (ff) statPills.push({ val: formatNum(ff), label: "FF" });
          } else if (pos === "LB") {
            const tkl = n(s.Tkl), tfl = n(s.TFL), sk = n(s.Sk), ff = n(s.FF), di = n(s.DefInt), pbu = n(s.PBU);
            if (tkl) statPills.push({ val: formatNum(tkl), label: "Tkl" });
            if (tfl) statPills.push({ val: formatNum(tfl), label: "TFL" });
            if (sk) statPills.push({ val: formatNum(sk), label: "Sacks" });
            if (ff) statPills.push({ val: formatNum(ff), label: "FF" });
            if (di) statPills.push({ val: formatNum(di), label: "INT" });
            if (pbu) statPills.push({ val: formatNum(pbu), label: "PBU" });
          } else if (pos === "DB" || pos === "CB" || pos === "S") {
            const di = n(s.DefInt), pbu = n(s.PBU), tkl = n(s.Tkl);
            if (di) statPills.push({ val: formatNum(di), label: "INT" });
            if (pbu) statPills.push({ val: formatNum(pbu), label: "PBU" });
            if (tkl) statPills.push({ val: formatNum(tkl), label: "Tkl" });
          }
          if (statPills.length === 0) return null;
          return (
            <div className="bg-white" style={{ padding: isMobile ? "6px 10px 12px" : "8px 24px 14px", borderTop: "1px solid #f0f0f0" }}>
              <div style={{ fontSize: "12px", fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#666", textAlign: "center", marginBottom: "8px" }}>
                {s.season ? `${s.season} Season Stats` : "Season Stats"}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", justifyContent: "center" }}>
                {statPills.map((m) => (
                  <div key={m.label} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", background: "#fff", border: `2px solid ${color1}`, borderRadius: "8px", padding: isMobile ? "5px 10px" : "7px 16px", minWidth: isMobile ? "52px" : "68px" }}>
                    <span style={{ fontSize: isMobile ? "12px" : "16px", fontWeight: 900, color: color1, lineHeight: 1.1 }}>{m.val}</span>
                    <span style={{ fontSize: isMobile ? "9px" : "11px", fontWeight: 800, color: "#888", letterSpacing: "0.08em", marginTop: "3px", textTransform: "uppercase" }}>{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

          <div style={{ height:"5px", backgroundColor:color2 }} />
        </div>

        {/* ===== Community Scouting Report ===== */}
        <div className="mb-8">
          <SectionTitle>Community Scouting Report</SectionTitle>
          {isMobile ? (
            <div className="bg-white rounded-lg overflow-hidden" style={{ border:`2px solid ${color1}` }}>
              <div className="flex items-start gap-4 px-3 py-3" style={{ borderBottom:"1px solid #e5e7eb" }}>
                <div style={{ flex:"0 0 100px" }}>
                  <div className="text-xs font-black uppercase pb-1 mb-2 text-center" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Grade</div>
                  {(() => {
                    // No scored evaluations yet -> represent that as a Watchlist
                    // grade (already a real, selectable grade value) rather than
                    // a blank "no grade" state, since that's what it means.
                    const hasGrade = community.avgGrade != null;
                    const label = hasGrade ? gradeLabels[Math.round(community.avgGrade)] : "Watchlist";
                    const { short, bg, border } = gradeDisplay(label);
                    return (
                      <div>
                        <div className="rounded text-center" style={{ backgroundColor:bg, border:`2px solid ${border}`, padding:"6px 10px" }}>
                          <div style={{ fontSize:"28px", fontWeight:900, color:"#fff", lineHeight:1 }}>{short}</div>
                          <div style={{ fontSize:"8px", fontWeight:800, color:"rgba(255,255,255,0.8)", textTransform:"uppercase", marginTop:"2px" }}>{label}</div>
                        </div>
                        {hasGrade && (
                          <div className="mt-2">
                            <div style={{ height:"5px", background:"#eee", borderRadius:"3px", position:"relative", overflow:"hidden" }}>
                              <div style={{ position:"absolute", left:`${((parseFloat(community.avgGrade)-1)/9)*92}%`, width:"8%", height:"100%", backgroundColor:bg, borderRadius:"3px" }} />
                            </div>
                            <div className="flex justify-between mt-1" style={{ fontSize:"8px", color:"#bbb", fontWeight:700 }}><span>1st</span><span>UDFA</span></div>
                          </div>
                        )}
                        {(selfIndex >= 0 || classRank) && (
                          <div className="mt-3">
                            <div className="text-xs font-black uppercase pb-1 mb-1 text-center" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em", fontSize:"9px" }}>Class Rank</div>
                            <div className="text-center" style={{ fontSize:"11px", fontWeight:900, color:"#444", letterSpacing:"0.02em", lineHeight:1.6 }}>
                              {selfIndex >= 0 && <div>{selfIndex+1} / {draftClassPlayers.length} {formatEligible(player.Eligible)} {player.Position}s</div>}
                              {classRank && <div>{classRank} / {classSize} {formatEligible(player.Eligible)} Prospects</div>}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div style={{ flex:1 }}>
                  <div className="text-xs font-black uppercase pb-1 mb-2 text-center" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>NFL Fit</div>
                  {fitLogos.length > 0 ? (
                    <div className="flex justify-center gap-2">
                      {fitLogos.map(({ teamName, logo }) => logo ? <img key={teamName} src={sanitizeUrl(logo)} alt={teamName} title={teamName} style={{ width:"40px", height:"40px", objectFit:"contain" }} referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}} /> : null)}
                    </div>
                  ) : community.topFits.length > 0 ? (
                    <div className="flex flex-col items-center gap-1">
                      {community.topFits.map((t,i) => <p key={i} className="text-xs font-bold text-gray-600 text-center">{t}</p>)}
                    </div>
                  ) : <p className="italic text-gray-400 text-xs text-center">No fits</p>}
                </div>
              </div>
              <div className="flex">
                <div className="flex-1 px-3 py-3" style={{ borderRight:"1px solid #e5e7eb" }}>
                  <div className="text-xs font-black uppercase pb-1 mb-2" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Strengths</div>
                  {community.topStrengths.length > 0 ? community.topStrengths.map((s,i) => (
                    <div key={i} className="py-1" style={{ borderBottom:i<community.topStrengths.length-1?"1px solid #f0f0f0":"none" }}>
                      <div className="font-black uppercase" style={{ fontSize:"10px", color:"#222", letterSpacing:"0.04em" }}>{s.term}</div>
                      {evalCount >= 5 && (
                        <div style={{ height:"3px", background:"#eee", borderRadius:"2px", marginTop:"3px", overflow:"hidden" }}>
                          <div style={{ width:`${barPct(s.pct)}%`, height:"100%", backgroundColor:"#16a34a", borderRadius:"2px" }} />
                        </div>
                      )}
                    </div>
                  )) : <p className="italic text-gray-400 text-xs">None yet</p>}
                </div>
                <div className="flex-1 px-3 py-3">
                  <div className="text-xs font-black uppercase pb-1 mb-2" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Weaknesses</div>
                  {community.topWeaknesses.length > 0 ? community.topWeaknesses.map((w,i) => (
                    <div key={i} className="py-1" style={{ borderBottom:i<community.topWeaknesses.length-1?"1px solid #f0f0f0":"none" }}>
                      <div className="font-black uppercase" style={{ fontSize:"10px", color:"#222", letterSpacing:"0.04em" }}>{w.term}</div>
                      {evalCount >= 5 && (
                        <div style={{ height:"3px", background:"#eee", borderRadius:"2px", marginTop:"3px", overflow:"hidden" }}>
                          <div style={{ width:`${barPct(w.pct)}%`, height:"100%", backgroundColor:"#dc2626", borderRadius:"2px" }} />
                        </div>
                      )}
                    </div>
                  )) : <p className="italic text-gray-400 text-xs">None yet</p>}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex bg-white rounded-lg overflow-hidden" style={{ border:`2px solid ${color1}` }}>
              <div className="flex flex-col items-center text-center px-6 py-5" style={{ flex:"0 0 210px", borderRight:"1px solid #e5e7eb" }}>
                <div className="text-sm font-black uppercase pb-2 mb-4 w-full text-center" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>Grade</div>
                {(() => {
                  // No scored evaluations yet -> represent that as a Watchlist
                  // grade (already a real, selectable grade value) rather than
                  // a blank "no grade" state, since that's what it means.
                  const hasGrade = community.avgGrade != null;
                  const label = hasGrade ? gradeLabels[Math.round(community.avgGrade)] : "Watchlist";
                  const { short, bg, border } = gradeDisplay(label);
                  return (
                    <>
                      <div className="rounded text-center" style={{ backgroundColor:bg, border:`3px solid ${border}`, padding:"10px 14px", width:"110px" }}>
                        <div style={{ fontSize:"36px", fontWeight:900, color:"#fff", lineHeight:1, letterSpacing:"-0.02em" }}>{short}</div>
                        <div style={{ fontSize:"8px", fontWeight:800, color:"rgba(255,255,255,0.8)", textTransform:"uppercase", letterSpacing:"0.07em", marginTop:"3px" }}>{label}</div>
                      </div>
                      {hasGrade && (
                        <div className="mt-4 w-full">
                          <div className="flex justify-between mb-1" style={{ fontSize:"9px", fontWeight:800, color:"#bbb", letterSpacing:"0.06em", textTransform:"uppercase" }}>
                            <span>1st Rd</span><span>UDFA</span>
                          </div>
                          <div style={{ height:"8px", background:"#eee", borderRadius:"4px", position:"relative", overflow:"hidden" }}>
                            <div style={{ position:"absolute", left:`${((parseFloat(community.avgGrade)-1)/9)*92}%`, width:"8%", height:"100%", backgroundColor:bg, borderRadius:"4px" }} />
                          </div>
                        </div>
                      )}
                      {(selfIndex >= 0 || classRank) && (
                        <div className="mt-4 w-full">
                          <div className="text-xs font-black uppercase pb-1 mb-2 text-center" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.1em" }}>Class Rank</div>
                          <div className="text-center" style={{ fontSize:"13px", fontWeight:900, color:"#444", letterSpacing:"0.02em", lineHeight:1.7 }}>
                            {selfIndex >= 0 && <div>{selfIndex+1} / {draftClassPlayers.length} {formatEligible(player.Eligible)} {player.Position}s</div>}
                            {classRank && <div>{classRank} / {classSize} {formatEligible(player.Eligible)} Prospects</div>}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              <div className="flex-1 px-5 py-5" style={{ borderRight:"1px solid #e5e7eb" }}>
                <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>Strengths</div>
                {community.topStrengths.length > 0 ? community.topStrengths.map((s,i) => (
                  <div key={i} className="py-2" style={{ borderBottom:i<community.topStrengths.length-1?"1px solid #f0f0f0":"none" }}>
                    <div className="font-black uppercase text-sm" style={{ color:"#222", letterSpacing:"0.06em" }}>{s.term}</div>
                    {evalCount >= 5 && (
                      <div style={{ height:"4px", background:"#eee", borderRadius:"2px", marginTop:"4px", overflow:"hidden" }}>
                        <div style={{ width:`${barPct(s.pct)}%`, height:"100%", backgroundColor:"#16a34a", borderRadius:"2px" }} />
                      </div>
                    )}
                  </div>
                )) : <p className="italic text-gray-400 text-sm">No strengths yet</p>}
              </div>
              <div className="flex-1 px-5 py-5" style={{ borderRight:"1px solid #e5e7eb" }}>
                <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>Weaknesses</div>
                {community.topWeaknesses.length > 0 ? community.topWeaknesses.map((w,i) => (
                  <div key={i} className="py-2" style={{ borderBottom:i<community.topWeaknesses.length-1?"1px solid #f0f0f0":"none" }}>
                    <div className="font-black uppercase text-sm" style={{ color:"#222", letterSpacing:"0.06em" }}>{w.term}</div>
                    {evalCount >= 5 && (
                      <div style={{ height:"4px", background:"#eee", borderRadius:"2px", marginTop:"4px", overflow:"hidden" }}>
                        <div style={{ width:`${barPct(w.pct)}%`, height:"100%", backgroundColor:"#dc2626", borderRadius:"2px" }} />
                      </div>
                    )}
                  </div>
                )) : <p className="italic text-gray-400 text-sm">No weaknesses yet</p>}
              </div>
              <div className="flex flex-col px-5 py-5" style={{ flex:"0 0 150px" }}>
                <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>NFL Fit</div>
                {fitLogos.length > 0 ? (
                  <div className="flex flex-col items-center justify-start flex-1 gap-3">
                    {fitLogos.map(({ teamName, logo }) => logo ? <img key={teamName} src={sanitizeUrl(logo)} alt={teamName} title={teamName} className="object-contain" style={{ width:"80px", height:"80px" }} referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}} /> : null)}
                  </div>
                ) : community.topFits.length > 0 ? (
                  <div className="flex flex-col gap-1">{community.topFits.map((t,i) => <p key={i} className="text-sm font-bold text-gray-600">{t}</p>)}</div>
                ) : <p className="italic text-gray-400 text-sm">No fits yet</p>}
              </div>
            </div>
          )}
        </div>

        {/* ===== Hidden Export Card ===== */}
        <div style={{ position:"absolute", left:"-9999px", top:0 }}>
          <div ref={exportCardRef} style={{ width:"700px", backgroundColor:"#ffffff", border:`6px solid ${color1}`, fontFamily:"'Arial Black', Arial, sans-serif", overflow:"hidden" }}>
            <div style={{ backgroundColor:color1, padding:"16px 28px", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ color:color2, fontSize:"30px", fontWeight:900, letterSpacing:"0.1em", textTransform:"uppercase" }}>WE-DRAFT.COM</div>
            </div>
            <div style={{ height:"5px", backgroundColor:color2 }} />
            <div style={{ padding:"24px 28px 16px", textAlign:"center" }}>
              <div style={{ fontSize:"56px", fontWeight:900, color:color1, lineHeight:1, letterSpacing:"0.02em", textTransform:"uppercase" }}>{player.First} {player.Last}</div>
              <div style={{ fontSize:"13px", fontWeight:700, color:"#999", letterSpacing:"0.08em", textTransform:"uppercase", marginTop:"8px" }}>Scouted by {scoutName}</div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:"12px", marginTop:"12px" }}>
                <span style={{ backgroundColor:color1, color:"#fff", fontWeight:900, fontSize:"16px", padding:"4px 18px", borderRadius:"20px", letterSpacing:"0.05em" }}>{player.Position}</span>
                <span style={{ color:"#ccc", fontSize:"20px" }}>·</span>
                <span style={{ color:color1, fontWeight:900, fontSize:"20px" }}>{player.School}</span>
                <span style={{ color:"#ccc", fontSize:"20px" }}>·</span>
                <span style={{ color:"#666", fontWeight:800, fontSize:"20px" }}>{formatEligible(player.Eligible)}</span>
              </div>
            </div>
            <div style={{ height:"2px", backgroundColor:color2, margin:"0 28px" }} />
            <div style={{ display:"flex", padding:"20px 28px" }}>
              <div style={{ flex:"0 0 160px", paddingRight:"24px", borderRight:"2px solid #eee", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
                <div style={{ fontSize:"10px", fontWeight:900, color:color1, letterSpacing:"0.14em", textTransform:"uppercase", borderBottom:`3px solid ${color1}`, paddingBottom:"5px", marginBottom:"14px", width:"100%", textAlign:"center" }}>Grade</div>
                {grade ? <GradeBadge g={grade} large={true} /> : <div style={{ color:"#aaa", fontSize:"13px", fontStyle:"italic" }}>No grade</div>}
              </div>
              <div style={{ flex:1, paddingLeft:"20px", paddingRight:"20px", borderRight:"2px solid #eee" }}>
                <div style={{ fontSize:"10px", fontWeight:900, color:color1, letterSpacing:"0.14em", textTransform:"uppercase", borderBottom:`3px solid ${color1}`, paddingBottom:"5px", marginBottom:"12px" }}>Strengths</div>
                {strengths.length > 0 ? strengths.map((s,i) => <div key={i} style={{ fontSize:"12px", fontWeight:900, textTransform:"uppercase", color:"#222", letterSpacing:"0.06em", padding:"4px 0", borderBottom:i<strengths.length-1?"1px solid #f0f0f0":"none" }}>{s}</div>) : <div style={{ color:"#aaa", fontSize:"12px", fontStyle:"italic" }}>—</div>}
              </div>
              <div style={{ flex:1, paddingLeft:"20px", paddingRight:"20px", borderRight:"2px solid #eee" }}>
                <div style={{ fontSize:"10px", fontWeight:900, color:color1, letterSpacing:"0.14em", textTransform:"uppercase", borderBottom:`3px solid ${color1}`, paddingBottom:"5px", marginBottom:"12px" }}>Weaknesses</div>
                {weaknesses.length > 0 ? weaknesses.map((w,i) => <div key={i} style={{ fontSize:"12px", fontWeight:900, textTransform:"uppercase", color:"#222", letterSpacing:"0.06em", padding:"4px 0", borderBottom:i<weaknesses.length-1?"1px solid #f0f0f0":"none" }}>{w}</div>) : <div style={{ color:"#aaa", fontSize:"12px", fontStyle:"italic" }}>—</div>}
              </div>
              <div style={{ flex:"0 0 110px", paddingLeft:"20px", display:"flex", flexDirection:"column", alignItems:"center" }}>
                <div style={{ fontSize:"10px", fontWeight:900, color:color1, letterSpacing:"0.14em", textTransform:"uppercase", borderBottom:`3px solid ${color1}`, paddingBottom:"5px", marginBottom:"12px", width:"100%", textAlign:"center" }}>NFL Fit</div>
                {nflFit ? <div style={{ fontSize:"12px", fontWeight:900, color:color1, textAlign:"center", textTransform:"uppercase", letterSpacing:"0.04em", lineHeight:1.3 }}>{nflFit}</div> : <div style={{ color:"#aaa", fontSize:"12px", fontStyle:"italic" }}>—</div>}
              </div>
            </div>
            {evaluation && (
              <>
                <div style={{ height:"2px", backgroundColor:color2, margin:"0 28px" }} />
                <div style={{ padding:"16px 28px" }}>
                  <div style={{ fontSize:"10px", fontWeight:900, color:color1, letterSpacing:"0.14em", textTransform:"uppercase", borderBottom:`3px solid ${color1}`, paddingBottom:"5px", marginBottom:"10px" }}>Scout's Take</div>
                  <div style={{ fontStyle:"italic", color:"#333", fontSize:"13px", lineHeight:1.6 }}>
                    {renderEvaluationText(evaluation, "export")}
                  </div>
                </div>
              </>
            )}
            <div style={{ height:"5px", backgroundColor:color2 }} />
            <div style={{ backgroundColor:color1, padding:"16px 28px", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ color:color2, fontSize:"30px", fontWeight:900, letterSpacing:"0.1em", textTransform:"uppercase" }}>WE-DRAFT.COM</div>
            </div>
          </div>
        </div>

        {/* ===== Evaluation Form ===== */}
        <div ref={evaluationFormRef} className="mb-8">
          <SectionTitle>My Evaluation</SectionTitle>
          <div className="bg-white rounded-lg overflow-hidden" style={{ border:`2px solid ${color1}` }}>
            <div className="flex items-center justify-between" style={{ backgroundColor:color1, padding:isMobile?"8px 12px":"10px 20px" }}>
              <div className="font-black uppercase text-white tracking-wide" style={{ fontSize:isMobile?"13px":"18px" }}>
                {`${player.First||""} ${player.Last||""}`.toUpperCase()}
              </div>
              <img src={Logo1} alt="We-Draft.com Logo" className="w-auto object-contain opacity-90" style={{ height:isMobile?"20px":"28px", filter:"brightness(0) invert(1)" }} />
            </div>

            {!user ? (
              <div style={{ padding: isMobile ? "24px 16px" : "36px 32px", textAlign: "center", background: "#fafafa" }}>
                <div style={{ fontSize: isMobile ? "20px" : "26px", fontWeight: 900, color: color1, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "12px" }}>
                  Create Your Scouting Report
                </div>
                <div style={{ fontSize: isMobile ? "14px" : "15px", fontWeight: 700, color: "#666", lineHeight: 1.65, maxWidth: "360px", margin: "0 auto 24px" }}>
                  Grade players, evaluate strengths and weaknesses, and find an NFL fit.
                </div>
                <button
                  onClick={login}
                  style={{
                    backgroundColor: color1, color: "#fff",
                    border: `3px solid ${color2}`,
                    borderRadius: "10px",
                    padding: isMobile ? "14px 28px" : "16px 40px",
                    fontWeight: 900, fontSize: isMobile ? "15px" : "17px",
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    cursor: "pointer", width: "100%", maxWidth: "360px",
                    boxShadow: `0 4px 20px ${color1}33`,
                  }}
                >
                  Sign In to Evaluate →
                </button>
                <div style={{ fontSize: "12px", color: "#aaa", marginTop: "12px", fontWeight: 700 }}>
                  Free · Sign in with Google
                </div>
              </div>
            ) : (
              <div style={{ padding:isMobile?"12px":"24px" }}>
                {gradeIsLocked && (
                  <div style={{ display:"flex", alignItems:"center", gap:"10px", background:"#fff8e1", border:`2px solid ${SITE_GOLD}`, borderRadius:"8px", padding:"10px 14px", marginBottom:"16px" }}>
                    <span style={{ fontSize:"18px" }}>🔒</span>
                    <div>
                      <div style={{ fontWeight:900, fontSize:"13px", color:"#7a5c00", textTransform:"uppercase", letterSpacing:"0.06em" }}>Grade Locked</div>
                      <div style={{ fontWeight:700, fontSize:"12px", color:"#9a7a00", marginTop:"2px" }}>
                        2026 draft grades were locked at 8PM ET on April 23rd. You can still edit your scouting notes, strengths, weaknesses, and NFL fit.
                      </div>
                    </div>
                  </div>
                )}

                <div className={isMobile?"flex flex-col gap-4 mb-4":"grid grid-cols-2 gap-6 mb-6"}>
                  <div>
                    <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>
                      Grade {gradeIsLocked && <span style={{ fontSize:"11px", color:"#aaa", fontWeight:700, textTransform:"none", letterSpacing:0 }}>— locked</span>}
                    </div>
                    {gradeIsLocked ? (
                      <div style={{ width:"100%", borderRadius:"6px", padding:"10px 12px", border:`2px solid #ddd`, background:"#f9f9f9", fontWeight:700, fontSize:"14px", color:"#888", display:"flex", alignItems:"center", gap:"8px" }}>
                        <span>🔒</span><span>{grade || "No grade set"}</span>
                      </div>
                    ) : (
                      <select value={grade} onChange={(e)=>setGrade(e.target.value)} className="w-full rounded px-3 py-2 border-2 font-bold" style={{ borderColor:color1, color:grade?"#111":"#999" }}>
                        <option value="">Select a grade</option>
                        {["Watchlist","Early First Round","Middle First Round","Late First Round","Second Round","Third Round","Fourth Round","Fifth Round","Sixth Round","Seventh Round","UDFA"].map((g)=><option key={g} value={g}>{g}</option>)}
                      </select>
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>Visibility</div>
                    <select value={visibility} onChange={(e)=>setVisibility(e.target.value)} className="w-full rounded px-3 py-2 border-2 font-bold" style={{ borderColor:color1 }}>
                      <option value="public">🌍 Public</option>
                      <option value="private">🔒 Private</option>
                    </select>
                  </div>
                </div>

                <div className={isMobile?"flex flex-col gap-4 mb-4":"grid grid-cols-2 gap-6 mb-6"}>
                  {[
                    { label:"Strengths (max 5)", state:strengths, setState:setStrengths, other:weaknesses },
                    { label:"Weaknesses (max 5)", state:weaknesses, setState:setWeaknesses, other:strengths },
                  ].map(({ label, state, setState, other }) => (
                    <div key={label}>
                      <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>{label}</div>
                      <details className="w-full rounded border-2" style={{ borderColor:color1 }}>
                        <summary className="cursor-pointer px-3 py-2 bg-white font-bold text-sm" style={{ color:state.length>0?"#111":"#999" }}>
                          {state.length>0 ? state.join(", ") : `Select ${label.split(" ")[0].toLowerCase()}`}
                        </summary>
                        <div className="px-3 py-2 bg-white">
                          {Object.entries(traits).map(([lbl, options]) => (
                            <div key={lbl} className="mb-2">
                              <p className="font-black text-xs uppercase tracking-wider mb-1" style={{ color:color1 }}>{lbl}</p>
                              {options.map((trait) => (
                                <label key={trait} className="block text-sm py-1 cursor-pointer">
                                  <input type="checkbox" checked={state.includes(trait)} disabled={(!state.includes(trait)&&state.length>=5)||other.includes(trait)}
                                    onChange={()=>setState(state.includes(trait)?state.filter((x)=>x!==trait):[...state,trait])} className="mr-2" />
                                  {trait}
                                </label>
                              ))}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  ))}
                </div>

                <div className="mb-4">
                  <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>NFL Fit</div>
                  <select value={nflFit} onChange={(e)=>setNflFit(e.target.value)} className="w-full rounded px-3 py-2 border-2 font-bold" style={{ borderColor:color1, color:nflFit?"#111":"#999" }}>
                    <option value="">Select an NFL team</option>
                    {["Arizona Cardinals","Atlanta Falcons","Baltimore Ravens","Buffalo Bills","Carolina Panthers","Chicago Bears","Cincinnati Bengals","Cleveland Browns","Dallas Cowboys","Denver Broncos","Detroit Lions","Green Bay Packers","Houston Texans","Indianapolis Colts","Jacksonville Jaguars","Kansas City Chiefs","Las Vegas Raiders","Los Angeles Chargers","Los Angeles Rams","Miami Dolphins","Minnesota Vikings","New England Patriots","New Orleans Saints","New York Giants","New York Jets","Philadelphia Eagles","Pittsburgh Steelers","San Francisco 49ers","Seattle Seahawks","Tampa Bay Buccaneers","Tennessee Titans","Washington Commanders"].map((team)=><option key={team} value={team}>{team}</option>)}
                  </select>
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between pb-2 mb-3" style={{ borderBottom:`3px solid ${color1}` }}>
                    <div className="text-sm font-black uppercase" style={{ color:color1, letterSpacing:"0.14em" }}>Evaluation</div>
                    <button
                      type="button"
                      onClick={handleInsertBullet}
                      style={{
                        display: "flex", alignItems: "center", gap: "5px",
                        background: "#fff", border: `1.5px solid ${color1}`, color: color1,
                        borderRadius: "6px", padding: "4px 10px", fontSize: "11px", fontWeight: 800,
                        textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
                      }}
                    >
                      • Add Bullet
                    </button>
                  </div>
                  <textarea
                    ref={evaluationTextareaRef}
                    value={evaluation}
                    onChange={(e)=>setEvaluation(e.target.value)}
                    placeholder="Write your evaluation... start a line with • or - for bullet points"
                    className="w-full rounded px-3 py-2 h-32 border-2 font-medium"
                    style={{ borderColor:color1 }}
                  />
                  <div style={{ fontSize: "11px", color: "#999", marginTop: "4px" }}>
                    Tip: start any line with • or - to make it a bullet point.
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button onClick={handleSaveEvaluation} disabled={saving} className="w-full font-black uppercase py-3 rounded transition hover:opacity-90" style={{ backgroundColor:color1, border:`2px solid ${color2}`, color:"#fff", letterSpacing:"0.08em" }}>
                    {saving?"Saving...":"Save Evaluation"}
                  </button>
                  <button onClick={handleExportImage} className="w-full font-black uppercase py-3 rounded transition hover:opacity-90" style={{ backgroundColor:"#fff", border:`2px solid ${color1}`, color:color1, letterSpacing:"0.08em" }}>
                    Export as Image
                  </button>
                  {(lastUpdated || archivedEval) && (
                    <button onClick={handleArchiveEvaluation} disabled={archiving || !lastUpdated} className="w-full font-black uppercase py-3 rounded transition hover:opacity-90"
                      style={{ backgroundColor:"#fff", border:`2px solid ${SITE_GOLD}`, color: lastUpdated ? "#7a5c00" : "#bbb", letterSpacing:"0.08em", cursor: lastUpdated ? "pointer" : "default" }}>
                      {archiving ? "Archiving..." : archivedEval ? "📦 Update Archive" : "📦 Archive This Evaluation"}
                    </button>
                  )}
                  {lastUpdated && <button onClick={handleRemoveEvaluation} className="w-full text-xs text-gray-400 hover:text-red-500 font-medium underline transition pt-1">Remove from Board</button>}
                  {lastUpdated && <p style={{ textAlign:"center", fontSize:"13px", fontWeight:700, color:"#888", marginTop:"4px" }}>Saved: {renderDate(lastUpdated)}</p>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===== Archived Evaluation ===== */}
        {user && archivedEval && (
          <div className="mb-8">
            <SectionTitle>My Archived Evaluation</SectionTitle>
            <div className="bg-white rounded-lg overflow-hidden" style={{ border:`2px solid ${SITE_GOLD}`, opacity: 0.95 }}>
              <div style={{ background:`linear-gradient(135deg, #7a5c00 0%, #b8860b 100%)`, padding:isMobile?"8px 12px":"10px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                  <span style={{ fontSize:"14px" }}>📦</span>
                  <span style={{ fontWeight:900, color:"#fff", fontSize:isMobile?"12px":"14px", textTransform:"uppercase", letterSpacing:"0.06em" }}>Archived Snapshot</span>
                  <span style={{ background:"rgba(255,255,255,0.2)", color:"#fff", fontSize:"9px", fontWeight:800, padding:"2px 8px", borderRadius:"20px", letterSpacing:"0.08em" }}>READ ONLY</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                  {(archivedEval.archivedAt || archivedEval.archivedAtISO) && (
                    <span style={{ color:"#fff", fontSize:"14px", fontWeight:900 }}>
                      {archivedEval.archivedAt?.toDate?.()?.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})
                        || (archivedEval.archivedAtISO ? new Date(archivedEval.archivedAtISO).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}) : "")}
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      if (!window.confirm("Delete your archived evaluation? This cannot be undone.")) return;
                      try {
                        const { deleteDoc, doc:fDoc } = await import("firebase/firestore");
                        await deleteDoc(fDoc(db,"users",user.uid,"archivedEvaluations",player.id));
                        setArchivedEval(null);
                      } catch(e) { alert("❌ Failed to delete archive. Try again."); }
                    }}
                    style={{ background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.4)", color:"#fff", borderRadius:"6px", padding:"4px 10px", fontSize:"11px", fontWeight:900, cursor:"pointer", letterSpacing:"0.04em" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(200,0,0,0.4)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.15)"; }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div style={{ height:"3px", background:SITE_GOLD }} />
              <div style={{ padding:isMobile?"12px":"20px", display:"flex", flexDirection:"column", gap:"16px" }}>
                {archivedEval.grade && (() => {
                  const gd = gradeDisplay(archivedEval.grade);
                  if (!gd) return null;
                  const isFirstRound = ["Early First Round","Middle First Round","Late First Round"].includes(archivedEval.grade);
                  const qualifier = isFirstRound ? archivedEval.grade.replace(" First Round","").toUpperCase() : null;
                  return (
                    <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                      <div style={{ display:"inline-flex", flexDirection:"column", alignItems:"center", justifyContent:"center", backgroundColor:gd.bg, border:`2px solid ${gd.border}`, borderRadius:"5px", width:"56px", height:"46px", flexShrink:0, gap:"1px" }}>
                        {qualifier && <span style={{ fontSize:"7px", fontWeight:900, color:"rgba(255,255,255,0.9)", textTransform:"uppercase", letterSpacing:"0.06em", lineHeight:1 }}>{qualifier}</span>}
                        <span style={{ fontSize:"16px", fontWeight:900, color:"#fff", lineHeight:1, letterSpacing:"-0.02em" }}>{gd.short}</span>
                        <span style={{ fontSize:"6px", fontWeight:800, color:"rgba(255,255,255,0.85)", textTransform:"uppercase", letterSpacing:"0.05em", lineHeight:1.1 }}>
                          {archivedEval.grade === "Watchlist" ? "WATCHLIST" : "ROUND"}
                        </span>
                      </div>
                      <div style={{ fontSize:isMobile?"13px":"15px", fontWeight:900, color:color1, textTransform:"uppercase", letterSpacing:"0.04em" }}>{archivedEval.grade}</div>
                    </div>
                  );
                })()}
                {(archivedEval.strengths?.length > 0 || archivedEval.weaknesses?.length > 0) && (
                  <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:"12px" }}>
                    {archivedEval.strengths?.length > 0 && (
                      <div>
                        <div style={{ fontSize:"10px", fontWeight:900, color:color1, textTransform:"uppercase", letterSpacing:"0.1em", borderBottom:`2px solid ${color1}`, paddingBottom:"4px", marginBottom:"8px" }}>Strengths</div>
                        {archivedEval.strengths.map((s,i) => (
                          <div key={i} style={{ fontSize:isMobile?"12px":"13px", fontWeight:800, color:"#222", textTransform:"uppercase", letterSpacing:"0.04em", padding:"3px 0", borderBottom:i<archivedEval.strengths.length-1?"1px solid #f0f0f0":"none" }}>{s}</div>
                        ))}
                      </div>
                    )}
                    {archivedEval.weaknesses?.length > 0 && (
                      <div>
                        <div style={{ fontSize:"10px", fontWeight:900, color:color1, textTransform:"uppercase", letterSpacing:"0.1em", borderBottom:`2px solid ${color1}`, paddingBottom:"4px", marginBottom:"8px" }}>Weaknesses</div>
                        {archivedEval.weaknesses.map((w,i) => (
                          <div key={i} style={{ fontSize:isMobile?"12px":"13px", fontWeight:800, color:"#222", textTransform:"uppercase", letterSpacing:"0.04em", padding:"3px 0", borderBottom:i<archivedEval.weaknesses.length-1?"1px solid #f0f0f0":"none" }}>{w}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {archivedEval.nflFit && (
                  <div>
                    <div style={{ fontSize:"10px", fontWeight:900, color:color1, textTransform:"uppercase", letterSpacing:"0.1em", borderBottom:`2px solid ${color1}`, paddingBottom:"4px", marginBottom:"8px" }}>NFL Fit</div>
                    <div style={{ fontSize:isMobile?"13px":"14px", fontWeight:800, color:"#333" }}>{archivedEval.nflFit}</div>
                  </div>
                )}
                {archivedEval.evaluation && (
                  <div>
                    <div style={{ fontSize:"10px", fontWeight:900, color:color1, textTransform:"uppercase", letterSpacing:"0.1em", borderBottom:`2px solid ${color1}`, paddingBottom:"4px", marginBottom:"8px" }}>Scout's Take</div>
                    <div style={{ fontStyle:"italic", fontSize:isMobile?"13px":"15px", color:"#222", lineHeight:1.6 }}>
                      {renderEvaluationText(archivedEval.evaluation, "archived")}
                    </div>
                  </div>
                )}
                <div style={{ fontSize:"11px", fontWeight:700, color:"#bbb", textAlign:"center", fontStyle:"italic" }}>
                  This evaluation is locked and cannot be edited. Use "Archive This Evaluation" on your current eval to update it.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== Public Feed ===== */}
        <div className="mb-10">
          <SectionTitle>Public Evaluations</SectionTitle>
          {publicFeed.length > 0 ? (
            <>
              {publicFeed.slice(0, visibleCount).map((ev) => (
                <div key={ev.uid} className="bg-white rounded-lg overflow-hidden mb-4" style={{ border:`2px solid ${color1}` }}>
                  <div className="flex items-center justify-between px-3 py-2" style={{ backgroundColor:color1 }}>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-white uppercase tracking-wide" style={{ fontSize:isMobile?"13px":"17px" }}>{ev.username}</span>
                      {ev.verified && <img src={verifiedBadge} alt="Verified" className="w-4 h-4 inline-block" />}
                    </div>
                    {ev.updatedAt && <span style={{ color:"rgba(255,255,255,0.85)", fontSize:"13px", fontWeight:700 }}>{renderDate(ev.updatedAt)}</span>}
                  </div>
                  {isMobile ? (
                    <div>
                      {ev.grade && (() => { const { short, bg, border } = gradeDisplay(ev.grade); return (
                        <div className="flex items-center gap-3 px-3 py-3" style={{ borderBottom:"1px solid #e5e7eb" }}>
                          <div className="rounded text-center flex-shrink-0" style={{ backgroundColor:bg, border:`2px solid ${border}`, padding:"6px 10px", minWidth:"60px" }}>
                            <div style={{ fontSize:"24px", fontWeight:900, color:"#fff", lineHeight:1 }}>{short}</div>
                            <div style={{ fontSize:"7px", fontWeight:800, color:"rgba(255,255,255,0.8)", textTransform:"uppercase", marginTop:"2px" }}>{ev.grade}</div>
                          </div>
                          {ev.nflFit && (
                            <div className="flex flex-col items-center">
                              <div style={{ fontSize:"8px", fontWeight:800, color:color1, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"3px" }}>NFL Fit</div>
                              {feedLogoCache[ev.nflFit] ? <img src={sanitizeUrl(feedLogoCache[ev.nflFit])} alt={ev.nflFit} title={ev.nflFit} style={{ width:"36px", height:"36px", objectFit:"contain" }} referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}} />
                                : <div style={{ fontSize:"10px", fontWeight:800, color:color1, textAlign:"center" }}>{ev.nflFit}</div>}
                            </div>
                          )}
                        </div>
                      ); })()}
                      {(ev.strengths?.length > 0 || ev.weaknesses?.length > 0) && (
                        <div className="flex" style={{ borderBottom:ev.evaluation?"1px solid #e5e7eb":"none" }}>
                          {ev.strengths?.length > 0 && <div className="flex-1 px-3 py-2" style={{ borderRight:ev.weaknesses?.length>0?"1px solid #e5e7eb":"none" }}>
                            <div style={{ fontSize:"8px", fontWeight:900, color:color1, textTransform:"uppercase", letterSpacing:"0.1em", borderBottom:`1px solid ${color1}`, paddingBottom:"3px", marginBottom:"4px" }}>Strengths</div>
                            {ev.strengths.map((s,i) => <div key={i} style={{ fontSize:"10px", fontWeight:900, textTransform:"uppercase", color:"#222", letterSpacing:"0.04em", padding:"2px 0" }}>{s}</div>)}
                          </div>}
                          {ev.weaknesses?.length > 0 && <div className="flex-1 px-3 py-2">
                            <div style={{ fontSize:"8px", fontWeight:900, color:color1, textTransform:"uppercase", letterSpacing:"0.1em", borderBottom:`1px solid ${color1}`, paddingBottom:"3px", marginBottom:"4px" }}>Weaknesses</div>
                            {ev.weaknesses.map((w,i) => <div key={i} style={{ fontSize:"10px", fontWeight:900, textTransform:"uppercase", color:"#222", letterSpacing:"0.04em", padding:"2px 0" }}>{w}</div>)}
                          </div>}
                        </div>
                      )}
                      {ev.evaluation && <div className="px-3 py-3" style={{ borderLeft: `3px solid ${color1}`, margin: "0 8px 8px", borderRadius: "0 4px 4px 0", background: "#fafafa" }}>
                        <div style={{ fontSize:"8px", fontWeight:900, color:color1, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"6px" }}>Scout's Take</div>
                        <div style={{ fontSize:"13px", fontWeight:600, color:"#111", lineHeight:1.65 }}>
                          <TruncatedEvaluationText text={ev.evaluation} keyPrefix={`feed-m-${ev.uid}`} color={color1} />
                        </div>
                      </div>}
                    </div>
                  ) : (
                    <div>
                      <div className="flex gap-0">
                        {ev.grade && (() => { const { short, bg, border } = gradeDisplay(ev.grade); return (
                          <div className="flex flex-col items-center justify-center text-center px-4 py-4" style={{ flex:"0 0 130px", borderRight:"1px solid #e5e7eb" }}>
                            <div className="font-black uppercase pb-1 mb-3 w-full text-center" style={{ fontSize:"14px", color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Grade</div>
                            <div className="rounded w-full text-center" style={{ backgroundColor:bg, border:`3px solid ${border}`, padding:"8px 10px" }}>
                              <div style={{ fontSize:"36px", fontWeight:900, color:"#fff", lineHeight:1, letterSpacing:"-0.02em" }}>{short}</div>
                              <div style={{ fontSize:"8px", fontWeight:800, color:"rgba(255,255,255,0.8)", textTransform:"uppercase", letterSpacing:"0.07em", marginTop:"3px" }}>{ev.grade}</div>
                            </div>
                          </div>
                        ); })()}
                        {ev.strengths?.length > 0 && <div className="flex-1 px-4 py-4" style={{ borderRight:"1px solid #e5e7eb" }}>
                          <div className="font-black uppercase pb-1 mb-3" style={{ fontSize:"14px", color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Strengths</div>
                          {ev.strengths.map((s,i) => <div key={i} className="font-black uppercase py-1" style={{ fontSize:"14px", color:"#222", letterSpacing:"0.06em", borderBottom:i<ev.strengths.length-1?"1px solid #f0f0f0":"none" }}>{s}</div>)}
                        </div>}
                        {ev.weaknesses?.length > 0 && <div className="flex-1 px-4 py-4" style={{ borderRight:ev.nflFit||ev.evaluation?"1px solid #e5e7eb":"none" }}>
                          <div className="font-black uppercase pb-1 mb-3" style={{ fontSize:"14px", color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Weaknesses</div>
                          {ev.weaknesses.map((w,i) => <div key={i} className="font-black uppercase py-1" style={{ fontSize:"14px", color:"#222", letterSpacing:"0.06em", borderBottom:i<ev.weaknesses.length-1?"1px solid #f0f0f0":"none" }}>{w}</div>)}
                        </div>}
                        {ev.nflFit && <div className="flex flex-col items-center justify-center px-4 py-4" style={{ flex:"0 0 120px", borderRight:ev.evaluation?"1px solid #e5e7eb":"none" }}>
                          <div className="font-black uppercase pb-1 mb-3 w-full text-center" style={{ fontSize:"14px", color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>NFL Fit</div>
                          {feedLogoCache[ev.nflFit] ? <img src={sanitizeUrl(feedLogoCache[ev.nflFit])} alt={ev.nflFit} title={ev.nflFit} className="object-contain" style={{ width:"52px", height:"52px" }} referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}} />
                            : <div className="font-black uppercase text-center" style={{ fontSize:"13px", color:color1, letterSpacing:"0.04em", lineHeight:1.4 }}>{ev.nflFit}</div>}
                        </div>}
                      </div>
                      {ev.evaluation && <>
                        <div style={{ height:"1px", backgroundColor:"#e5e7eb", margin:"0 16px" }} />
                        <div className="px-4 py-4">
                          <div className="font-black uppercase pb-1 mb-3" style={{ fontSize:"14px", color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Scout's Take</div>
                          <div style={{ borderLeft:`3px solid ${color1}`, paddingLeft:"14px", background:"#fafafa", borderRadius:"0 4px 4px 0", padding:"10px 14px" }}>
                            <div style={{ fontSize:"16px", fontWeight:600, color:"#111", lineHeight:1.7 }}>
                              <TruncatedEvaluationText text={ev.evaluation} keyPrefix={`feed-d-${ev.uid}`} color={color1} />
                            </div>
                          </div>
                        </div>
                      </>}
                    </div>
                  )}
                </div>
              ))}
              {visibleCount < publicFeed.length && (
                <button onClick={()=>setVisibleCount((prev)=>prev+3)} className="w-full font-black uppercase py-3 rounded transition hover:opacity-90" style={{ backgroundColor:color1, border:`2px solid ${color2}`, color:"#fff", letterSpacing:"0.08em" }}>
                  Show More
                </button>
              )}
            </>
          ) : (
            <p className="italic text-gray-400 text-sm">No public evaluations yet.</p>
          )}
        </div>

        </div>
        {/* ===== END MAIN COLUMN ===== */}

        {/* ===== RIGHT COLUMN: Videos + In The News ===== */}
        {isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {playerVideos.length > 0 && VideosSidebar}
            {NewsSidebar}
          </div>
        ) : (
          <div style={{ position: "sticky", top: "20px", display: "flex", flexDirection: "column", gap: "18px" }}>
            {playerVideos.length > 0 && VideosSidebar}
            {NewsSidebar}
          </div>
        )}

      </div>

      {showMarginAds && !isMobile && adData && (
        <>
          <MarginAd side="left" />
          <MarginAdTeamCard side="right" />
        </>
      )}
    </>
  );
}