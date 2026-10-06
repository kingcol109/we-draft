// src/pages/Comparison.js
//
// Public "Find Comparison" calculator — reached from PlayerProfile.js's
// Find Comparison button (/comparison/<Slug>, same Slug format player pages
// use, e.g. "jeremiah-smith-2027-wr"), which preloads that prospect's
// measurables + community Strengths/Weaknesses and runs them against every
// drafted player (historical + the latest not-yet-migrated class) using the
// same findComps math as AdminPanel.js's internal Comp Calculator
// (HistoricalCompsView). This is a real calculator, not just a read-out —
// visitors can load a different prospect via search, tweak measurements/
// traits by hand, or build a fully custom entry, exactly like the admin
// tool. The results are the point of the page, though, so the input form
// collapses to a one-line summary the moment a search actually runs
// (auto-preload or manual) — "Edit Inputs" reopens it. /comparison with no
// slug opens blank, form expanded, since there's nothing else to show yet.
//
// Hero is themed with the loaded prospect's own school colors (schools/
// {School}.Color1/Color2 — same source PlayerProfile.js's hero uses) so
// this reads as that player's page, not a generic tool; falls back to the
// site navy/gold before anyone's loaded.
//
// Gated behind config/features.comparisonEnabled (toggled in Admin >
// Branding > Misc, see AdminPanel.js's ComparisonFeatureToggle) so the
// route itself is blocked, not just unlinked, until it's ready. Off/missing
// redirects home, same shape as AdminRoute.js's auth gate.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, Link, Navigate } from "react-router-dom";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import LoadingSpinner from "../components/LoadingSpinner";
import MarginAds from "../components/MarginAds";
import { usePlayerSidebarData, PlayerVideosCard, PlayerNewsCard } from "../components/PlayerSidebars";
// "Playing now" + Follow Live while the loaded prospect's team is on the
// field — the same card / button as their player page.
import PlayerLiveCard from "../components/PlayerLiveCard";
import { WatchButton } from "./PlayerProfile";
import { Helmet } from "react-helmet-async";
import WdWordmark from "../assets/Logo1.png";
import {
  STAT_METRICS, readMetric, computePositionStats, findComps, isGraded,
  communityTraits, draftedPlayersAsHistorical, TRAIT_WEIGHT, TRAIT_MATCH_TARGET, percentileOf,
  decodeCompSnapshotRows, COMP_SNAPSHOT_VERSION, recommendedCompWindow, inRecommendedWindow, doubleExtendedFor,
} from "../utils/historicalStats";

const BLUE = "#0055a5";
const NAVY = "#00305c";
const GOLD = "#f6a21d";
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB"];
const ACTIVE_YEARS = ["2027", "2028", "2029"];
// The most recently drafted class isn't migrated into `historical` yet —
// same LATEST_DRAFT_YEAR idea as AdminPanel.js's Comp Calculator, pulled
// from players + draftOrder and merged in so this year's picks are
// eligible comps too.
const LATEST_DRAFT_YEAR = "2026";
const EIGHTHS_FRACTION_LABEL = { 0: "", 1: "⅛", 2: "¼", 3: "⅜", 4: "½", 5: "⅝", 6: "¾", 7: "⅞" };
const HEIGHT_WINDOW_OPTIONS = [
  { value: "", label: "Off" },
  { value: "0.5", label: "Tight" },
  { value: "1", label: "Medium" },
  { value: "2", label: "Wide" },
];
const TRAIT_WEIGHT_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "1", label: "Low" },
  { value: "2", label: "Medium" },
  { value: "4", label: "High" },
];
const COMP_PHYSICAL_KEYS = ["height", "weight", "arm", "hand"];
const COMP_ATHLETIC_KEYS = ["forty", "vertical", "broad", "bench", "threeCone", "shuttle"];
// All 32 NFL team abbreviations + full-name lookup, duplicated from
// PlayerProfile.js (teamNameFromAbbr/teamNameToAbbr) — needed to resolve a
// result's "NFL Team" field into an nfl/{abbr} doc id. Real `historical`
// rows store the full name ("Green Bay Packers"); the merged latest class
// (draftedPlayersAsHistorical) carries the draftOrder abbreviation
// ("GB") directly — resolveNflAbbr below handles both.
const NFL_TEAM_ABBRS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WAS",
];
const TEAM_NAME_TO_ABBR = {
  "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL", "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR", "Chicago Bears": "CHI", "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL", "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
  "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX", "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC", "Los Angeles Rams": "LAR", "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN", "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
  "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT", "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB", "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
};
function resolveNflAbbr(teamField) {
  if (!teamField) return null;
  if (NFL_TEAM_ABBRS.includes(teamField)) return teamField;
  return TEAM_NAME_TO_ABBR[teamField] || null;
}
const TEAM_ABBR_TO_NAME = Object.fromEntries(Object.entries(TEAM_NAME_TO_ABBR).map(([name, abbr]) => [abbr, name]));
function displayTeamName(teamField) {
  return teamField ? (TEAM_ABBR_TO_NAME[teamField] || teamField) : "";
}

// Same URL-cleanup chain PlayerProfile.js's hero logos/wordmarks use
// (imgur single-page links, Google Drive share links, bare domains) —
// duplicated locally, not shared.
function sanitizeImgur(url) {
  if (!url) return "";
  if (/^https?:\/\/i\.imgur\.com\/.+\.(png|jpe?g|gif|webp)$/i.test(url)) return url;
  // imgur.com/<id>.<ext> (no "i.") is a 302 to i.imgur.com whose redirect
  // response only allows origin imgur.com — fine for a plain <img>, but it
  // fails the crossOrigin load TrimmedImg needs to read pixels, so those
  // wordmarks silently rendered untrimmed. Point straight at i.imgur.com
  // (Access-Control-Allow-Origin: *) instead.
  const directMatch = url.match(/^https?:\/\/imgur\.com\/([A-Za-z0-9]+)\.(png|jpe?g|gif|webp)$/i);
  if (directMatch) return `https://i.imgur.com/${directMatch[1]}.${directMatch[2]}`;
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

// ── decimal-inches <-> feet/inches(/eighths) form-field decompose/recompose,
// duplicated from AdminPanel.js's HistoricalCompsView (see that file — not
// shared, each page owns its own small copy) ──
function decomposeHeight(decimalStr) {
  const num = parseFloat(decimalStr);
  if (isNaN(num)) return { feet: "", inches: "", eighths: 0 };
  const totalWhole = Math.floor(num);
  let eighths = Math.round((num - totalWhole) * 8);
  let wholeAdj = totalWhole;
  if (eighths === 8) { eighths = 0; wholeAdj += 1; }
  return { feet: Math.floor(wholeAdj / 12), inches: wholeAdj % 12, eighths };
}
function recomposeHeight({ feet, inches, eighths }) {
  const feetBlank = feet === "" || feet == null;
  const inchesBlank = inches === "" || inches == null;
  if (feetBlank && inchesBlank) return "";
  const f = feetBlank ? 0 : Number(feet);
  const i = inchesBlank ? 0 : Number(inches);
  return (f * 12 + i + Number(eighths || 0) / 8).toString();
}
function decomposeInches(decimalStr) {
  const num = parseFloat(decimalStr);
  if (isNaN(num)) return { whole: "", eighths: 0 };
  const whole = Math.floor(num);
  let eighths = Math.round((num - whole) * 8);
  let wholeAdj = whole;
  if (eighths === 8) { eighths = 0; wholeAdj += 1; }
  return { whole: wholeAdj, eighths };
}
function recomposeInches({ whole, eighths }) {
  if (whole === "" || whole == null) return "";
  return (Number(whole) + Number(eighths || 0) / 8).toString();
}
function decomposeFeetInches(decimalStr) {
  const num = parseFloat(decimalStr);
  if (isNaN(num)) return { feet: "", inches: "" };
  const totalWhole = Math.round(num);
  return { feet: Math.floor(totalWhole / 12), inches: totalWhole % 12 };
}
function recomposeFeetInches({ feet, inches }) {
  const feetBlank = feet === "" || feet == null;
  const inchesBlank = inches === "" || inches == null;
  if (feetBlank && inchesBlank) return "";
  const f = feetBlank ? 0 : Number(feet);
  const i = inchesBlank ? 0 : Number(inches);
  return (f * 12 + i).toString();
}
const COMP_PICKERS = {
  height: { decompose: decomposeHeight, recompose: recomposeHeight },
  inches: { decompose: decomposeInches, recompose: recomposeInches },
  feetInches: { decompose: decomposeFeetInches, recompose: recomposeFeetInches },
};
function formatHeightDisplay(decimalStr) {
  const { feet, inches, eighths } = decomposeHeight(decimalStr);
  if (feet === "") return "—";
  const frac = EIGHTHS_FRACTION_LABEL[eighths];
  return `${feet}'${inches}${frac ? " " + frac : ""}"`;
}
function formatInchesDisplay(decimalStr) {
  const { whole, eighths } = decomposeInches(decimalStr);
  if (whole === "") return "—";
  const frac = EIGHTHS_FRACTION_LABEL[eighths];
  return `${whole}${frac ? " " + frac : ""}"`;
}
function formatFeetInchesDisplay(decimalStr) {
  const { feet, inches } = decomposeFeetInches(decimalStr);
  if (feet === "") return "—";
  return `${feet}'${inches}"`;
}
function formatStatValue(metric, v) {
  if (v == null) return "—";
  if (metric.format === "height") return formatHeightDisplay(String(v));
  if (metric.format === "inches") return formatInchesDisplay(String(v));
  if (metric.format === "feetInches") return formatFeetInchesDisplay(String(v));
  if (metric.suffix) return `${Number(v.toFixed(metric.decimals ?? 1))}${metric.suffix}`;
  return v.toFixed(metric.decimals ?? 1);
}

// The most recently drafted class merged in via draftedPlayersAsHistorical
// carries First/Last (its players doc shape), not a combined Player field
// like real `historical` rows — same fallback AdminPanel.js's own results
// table uses.
function recordName(record) {
  return record.Player || `${record.First || ""} ${record.Last || ""}`.trim();
}
// [first, last] for the top-3 cards' stacked name — First/Last when the
// record has them, otherwise the legacy Player string split at its first
// space (same rule as AdminPanel.js's HistoricalSection legacy split, so
// "T. J. Watt" reads "T." / "J. Watt" rather than guessing).
function recordNameParts(record) {
  if (record.First || record.Last) return [record.First || "", record.Last || ""];
  const parts = (record.Player || "").trim().split(/\s+/);
  return [parts[0] || "", parts.slice(1).join(" ")];
}

// Similarity tier -> accent color + ring, used for the spotlight badges.
function matchTier(pct) {
  if (pct >= 85) return { color: GOLD, label: "Elite Match" };
  if (pct >= 70) return { color: "#2e7d32", label: "Strong Match" };
  if (pct >= 50) return { color: BLUE, label: "Solid Match" };
  return { color: "#888", label: "Loose Match" };
}

// ── Grade scale/labels/badge colors + Eligible formatting, duplicated from
// PlayerProfile.js (module-scope there, not exported) — used by the left
// margin's class list so its rows look exactly like the player page's. ──
const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3, "Second Round": 4,
  "Third Round": 5, "Fourth Round": 6, "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, "UDFA": 10,
};
const gradeLabels = Object.fromEntries(Object.entries(gradeScale).map(([label, v]) => [v, label]));
// Projected draft round from a prospect's evaluations: the rounded community
// grade (same averaging as CommunityBoard.js), Early/Middle/Late First all
// being round 1. null for UDFA or no grades. Feeds findComps' early-round
// boost (see historicalStats.js).
const projectedRound = (evals) => {
  const vals = evals.map((e) => gradeScale[e.grade]).filter(Boolean);
  if (!vals.length) return null;
  const g = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  return g <= 3 ? 1 : g <= 9 ? g - 2 : null;
};
const gradeDisplay = (g) => {
  const map = {
    "Watchlist":          { short: "W",   bg: "#5F5E5A", border: "#444441" },
    "Early First Round":  { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Middle First Round": { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Late First Round":   { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Second Round":       { short: "2nd", bg: "#0F6E56", border: "#085041" },
    "Third Round":        { short: "3rd", bg: "#185FA5", border: "#0C447C" },
    "Fourth Round":       { short: "4th", bg: "#BA7517", border: "#854F0B" },
    "Fifth Round":        { short: "5th", bg: "#BA7517", border: "#854F0B" },
    "Sixth Round":        { short: "6th", bg: "#993C1D", border: "#712B13" },
    "Seventh Round":      { short: "7th", bg: "#993C1D", border: "#712B13" },
    "UDFA":               { short: "U",   bg: "#A32D2D", border: "#791F1F" },
  };
  return map[g] || { short: g, bg: "#5F5E5A", border: "#444441" };
};
const formatEligible = (eligible) => {
  if (!eligible) return "";
  const match = String(eligible).match(/^(\d{4})s$/i);
  if (match) return `${match[1]} (Supplemental)`;
  return String(eligible);
};
const DRAFT_CLASS_LIMIT = 20;
const SITE_URL = "https://we-draft.com";
// JSON-LD goes into a raw <script> body, so a "<" in any value (a player
// name can't realistically contain "</script>", but nothing enforces that)
// is escaped to its \u003c JSON form — still valid JSON, can't close the tag.
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const STACK_BELOW = 1240;

// Height of the top-3 cards' wordmark band (and the tallest a mark can get).
const WORDMARK_BAND = "120px";

// Left-margin class list: the loaded prospect's own Eligible + Position
// group, ranked by community grade exactly like PlayerProfile.js's Draft
// Class sidebar (sort by *rounded* grade label, ungraded last, ties left in
// natural order). Normally one read: the group's precomputed list
// (compSnapshots/class_{Eligible}_{Position}, written by the admin
// rebuild with each player's average grade already computed). Falls back
// to live reads if that doc is missing — just that class + position
// (two equality filters, no composite index needed) and each player's
// evaluations. Works for any class, including already-drafted 2026.
// Cached per group for the session so clicking between classmates doesn't
// refetch.
const classListCache = {};
function rankClassList(list) {
  const rank = (x) => (x.avgGrade != null ? gradeScale[gradeLabels[Math.round(x.avgGrade)]] : null);
  return list.sort((a, b) => {
    const aV = rank(a), bV = rank(b);
    if (aV && bV) return aV - bV;
    if (aV && !bV) return -1;
    if (!aV && bV) return 1;
    return 0;
  });
}
function fetchClassList(eligible, position) {
  const key = `${eligible}|${position}`;
  if (!classListCache[key]) {
    classListCache[key] = getDoc(doc(db, "compSnapshots", `class_${eligible}_${position}`))
      .then((snap) => snap, () => null)
      .then((snap) => {
        const data = snap?.exists() ? snap.data() : null;
        if (data && data.version === COMP_SNAPSHOT_VERSION && Array.isArray(data.rows)) {
          const rows = data.rows.map((r) => ({
            id: r.i, First: r.F || "", Last: r.L || "", School: r.s || "", Slug: r.sl || "", avgGrade: r.g ?? null,
            // Drafted class only (see utils/snapshotBuilders.js): pick info,
            // and the rows are already in draft order — don't re-rank.
            draftRound: r.rd ?? null, draftPick: r.pk ?? null, draftTeam: r.tm || "", teamLogo: r.tl || "",
          }));
          return data.order === "draft" ? rows : rankClassList(rows);
        }
        return fetchClassListLive(eligible, position);
      })
      .catch((e) => { delete classListCache[key]; throw e; });
  }
  return classListCache[key];
}
function fetchClassListLive(eligible, position) {
  return getDocs(query(collection(db, "players"), where("Eligible", "==", eligible), where("Position", "==", position))).then((snap) => {
    const group = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.Live !== false);
    return Promise.all(group.map(async (p) => {
      let avgGrade = null;
      try {
        const evSnap = await getDocs(collection(db, "players", p.id, "evaluations"));
        const grades = [];
        evSnap.forEach((ev) => { const g = ev.data().grade; if (g && gradeScale[g]) grades.push(gradeScale[g]); });
        if (grades.length) avgGrade = grades.reduce((a, b) => a + b, 0) / grades.length;
      } catch { /* ungraded */ }
      return { id: p.id, First: p.First || "", Last: p.Last || "", School: p.School || "", Slug: p.Slug || "", avgGrade };
    }));
  }).then(rankClassList);
}

// ── Transparent-padding trim for uploaded wordmarks. Source PNGs often sit
// on a much larger transparent canvas (the Eagles one is 1024x512 with the
// actual mark in a ~165px-tall strip), and objectFit: contain sizes to the
// whole canvas — so the visible mark renders a fraction of its box. This
// draws the image to a canvas once, finds the bounding box of non-
// transparent pixels, and hands back a cropped data URL; cached per URL.
// Needs CORS on the image host (imgur sends Access-Control-Allow-Origin: *);
// any failure — CORS, decode, fully transparent — just resolves to the
// original URL, so the worst case is the old padded look. ──
const trimCache = {};
function trimTransparent(url) {
  if (!trimCache[url]) {
    trimCache[url] = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const w = img.naturalWidth, h = img.naturalHeight;
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const { data } = ctx.getImageData(0, 0, w, h);
          let top = h, left = w, right = -1, bottom = -1;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              if (data[(y * w + x) * 4 + 3] > 8) {
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
              }
            }
          }
          if (right < 0) { resolve(url); return; }
          const out = document.createElement("canvas");
          out.width = right - left + 1; out.height = bottom - top + 1;
          out.getContext("2d").drawImage(c, left, top, out.width, out.height, 0, 0, out.width, out.height);
          resolve(out.toDataURL("image/png"));
        } catch {
          resolve(url);
        }
      };
      img.onerror = () => resolve(url);
      img.src = url;
    });
  }
  return trimCache[url];
}
// <img> that renders the trimmed version once it's ready (nothing before
// that, so the padded original never flashes in first).
function TrimmedImg({ src, alt, style }) {
  const [trimmed, setTrimmed] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setTrimmed(null);
    trimTransparent(src).then((u) => { if (!cancelled) setTrimmed(u); });
    return () => { cancelled = true; };
  }, [src]);
  if (!trimmed) return null;
  return <img src={trimmed} alt={alt} style={style} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
}

// Comps only ever come from draft classes *before* the prospect's own —
// a 2026 prospect is compared against 2025 and earlier (never his own
// class, which would include his own draft record and match him to
// himself); a 2027-2029 prospect's cutoff is past every drafted class, so
// it changes nothing for them. Eligible can carry a supplemental suffix
// ("2026s"), hence parseInt. null (no cutoff) for a custom entry.
function compCutoffYear(player) {
  const y = parseInt(player?.Eligible, 10);
  return Number.isFinite(y) ? y : null;
}

// Draft Classes. The default is "We-Draft Recommended" (classMode
// "recommended" — see recommendedCompWindow: the last 10 classes, plus
// Extended-only players from the 5 before that, plus Double Extended
// players from any earlier class for a round 1-2 subject). "Custom" opens a From/To
// range that takes everyone in it, Extended or not. Only classes that
// actually have graded players (Strengths AND Weaknesses — the only
// eligible comps, see findComps' requireTraits) are offered, oldest first.
// A custom range's "from" starts at the recommended window's first full
// class (or the earliest graded class, if grading hasn't reached back that
// far); "to" at the latest graded class. Blank select state ("") means
// "use the default", resolved against the pool at search time.
function gradedClassYears(pool, beforeYear) {
  return [...new Set((pool || [])
    .filter((r) => isGraded(r) && r.SelectOnly !== true && r.Year && (beforeYear == null || Number(r.Year) < beforeYear))
    .map((r) => String(r.Year)))].sort();
}
function defaultFromYear(years, win) {
  const from = win ? win.coreFrom : 0;
  return years.find((y) => Number(y) >= from) || years[years.length - 1] || "";
}

// 1 -> "1st", 22 -> "22nd", 88 -> "88th" (11-13 -> "th").
function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

// True for a light hex color (e.g. a yellow/white team Color1) — the top-3
// cards flip to dark text on those so the filled hover state stays legible.
function isLightColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.65;
}

// Comp pool, one position at a time — every comp, SD, and percentile on
// this page is within a single position, so there's no reason to read the
// other ~90% of `historical` (6,643 rows) or evaluate every drafted
// latest-class player. Per position: that position's historical rows +
// that position's latest-class players (two equality filters, no
// composite index needed) + evaluations for just the ones who were
// drafted. draftOrder (~260 small docs) is shared across positions and
// read once. Each position is cached for the page session, so switching
// back to one already loaded is free. Cleared on failure so a retry can
// happen.
let draftOrderPromise = null;
function fetchDraftOrder() {
  if (!draftOrderPromise) {
    draftOrderPromise = getDocs(collection(db, "draftOrder"))
      .then((snap) => snap.docs.map((d) => d.data()))
      .catch((e) => { draftOrderPromise = null; throw e; });
  }
  return draftOrderPromise;
}
// Normal path: one read — the position's precomputed snapshot
// (compSnapshots/{Position}, built from the admin Historical tab; see
// encodeCompSnapshotRows in utils/historicalStats.js), which holds every
// drafted player at the position in the same shape the live queries below
// produce, so everything downstream is identical. Falls back to the live
// queries if the snapshot is missing, from an older format version, or
// unreadable (e.g. before the first rebuild / rules deploy), so the page
// never breaks for want of a snapshot — it just costs more reads.
const positionPoolCache = {};
function fetchPositionPool(position) {
  if (!positionPoolCache[position]) {
    positionPoolCache[position] = getDoc(doc(db, "compSnapshots", position))
      .then((snap) => snap, () => null)
      .then((snap) => {
        const data = snap?.exists() ? snap.data() : null;
        if (data && data.version === COMP_SNAPSHOT_VERSION && Array.isArray(data.rows)) {
          return decodeCompSnapshotRows(data.rows, position);
        }
        return fetchPositionPoolLive(position);
      })
      .catch((e) => {
        delete positionPoolCache[position];
        throw e;
      });
  }
  return positionPoolCache[position];
}
// The pre-snapshot path — also the fallback (see fetchPositionPool).
function fetchPositionPoolLive(position) {
  return Promise.all([
    getDocs(query(collection(db, "historical"), where("Position", "==", position))),
    getDocs(query(collection(db, "players"), where("Eligible", "==", LATEST_DRAFT_YEAR), where("Position", "==", position))),
    fetchDraftOrder(),
  ]).then(async ([histSnap, latestSnap, draftOrder]) => {
    const historical = histSnap.docs.map((d) => d.data());
    const latestRows = draftedPlayersAsHistorical(
      latestSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      draftOrder,
      LATEST_DRAFT_YEAR
    );
    const evalSnaps = await Promise.all(latestRows.map((r) => getDocs(collection(db, "players", r.id, "evaluations"))));
    const latestClass = latestRows.map((r, i) => {
      const { strengths, weaknesses } = communityTraits(evalSnaps[i].docs.map((d) => d.data()));
      return { ...r, Strengths: strengths, Weaknesses: weaknesses };
    });
    return [...historical.filter((r) => r.Year !== LATEST_DRAFT_YEAR), ...latestClass];
  });
}
// Prospect search list — only loaded when someone actually focuses the
// search box (most visitors, especially from search engines, never do), and
// normally one read: the admin rebuild's compSnapshots/_search index
// (id/name/position/school/class/slug for every ACTIVE_YEARS prospect).
// Falls back to querying those players directly if the index is missing.
// Picking a result navigates to its /comparison/<slug>, and the route
// effect loads the full player doc from there — the index rows are only
// what the dropdown needs to show.
let activePlayersPromise = null;
function fetchActivePlayers() {
  if (!activePlayersPromise) {
    activePlayersPromise = getDoc(doc(db, "compSnapshots", "_search"))
      .then((snap) => snap, () => null)
      .then((snap) => {
        const data = snap?.exists() ? snap.data() : null;
        if (data && data.version === COMP_SNAPSHOT_VERSION && Array.isArray(data.rows)) {
          return data.rows.map((r) => ({ id: r.i, First: r.F, Last: r.L, Position: r.P, School: r.S, Eligible: r.E, Slug: r.sl }));
        }
        return fetchActivePlayersLive();
      })
      .catch((e) => { activePlayersPromise = null; throw e; });
  }
  return activePlayersPromise;
}
function fetchActivePlayersLive() {
  return getDocs(query(collection(db, "players"), where("Eligible", "in", ACTIVE_YEARS)))
    .then((snap) => snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => `${a.Last || ""} ${a.First || ""}`.localeCompare(`${b.Last || ""} ${b.First || ""}`)));
}

const COMP_DISCLAIMER = "Comparisons are computed using pre-draft measurables and grades, and should be treated as such rather than a projection of career trajectory.";

// Small "i" next to a heading — hover (mouse) or tap (touch) shows the text
// in a bubble underneath. Rendered inline so it sits right after the text.
function InfoTip({ text, color }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-block", verticalAlign: "middle", marginLeft: "8px" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="About these comparisons"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        style={{
          width: "18px", height: "18px", borderRadius: "50%", border: `1.5px solid ${color}`, background: "#fff",
          color, fontSize: "11px", fontWeight: 900, fontStyle: "italic", fontFamily: "Georgia, serif",
          lineHeight: "15px", padding: 0, cursor: "pointer", textTransform: "none",
        }}
      >
        i
      </button>
      {open && (
        <span role="tooltip" style={{
          position: "absolute", top: "calc(100% + 8px)", right: "-8px", zIndex: 20,
          width: "min(280px, 80vw)", padding: "10px 12px", borderRadius: "8px",
          background: NAVY, color: "#fff", boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
          fontSize: "12px", fontWeight: 600, lineHeight: 1.45, letterSpacing: "normal", textTransform: "none", textAlign: "left",
        }}>
          {text}
        </span>
      )}
    </span>
  );
}

const cardStyle = { background: "#fff", borderRadius: "16px", boxShadow: "0 2px 18px rgba(0,40,80,0.10)", overflow: "hidden" };
const labelStyle = { fontSize: "10px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: "5px" };
const sectionStyle = { fontSize: "11px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" };
const inputStyle = { width: "100%", border: "2px solid #e4e9f0", borderRadius: "8px", padding: "9px 10px", fontWeight: 700, fontSize: "13px", outline: "none", boxSizing: "border-box", fontFamily: "inherit", background: "#fbfcfe" };

export default function Comparison() {
  const { slug: routeSlug } = useParams();
  const navigate = useNavigate();

  const [featureChecked, setFeatureChecked] = useState(false);
  const [featureEnabled, setFeatureEnabled] = useState(false);

  // position -> that position's comp pool (see fetchPositionPool); a
  // position is absent until its fetch lands.
  const [poolByPos, setPoolByPos] = useState({});
  const [activePlayers, setActivePlayers] = useState([]);
  const [playerSearch, setPlayerSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // Search results are portaled to document.body (the hero band is
  // overflow:hidden, which would clip them — same reason PlayerProfile.js
  // portals its trend-tag tooltips) and pinned under the input with
  // position: fixed, re-measured on scroll/resize while open.
  const searchInputRef = useRef(null);
  const [searchRect, setSearchRect] = useState(null);

  const [loadedPlayer, setLoadedPlayer] = useState(null); // the full player doc, for header/link-back
  // The loaded prospect's draft round — actual if drafted, else projected
  // from community grade. Only nudges ranking (findComps' subjectRound).
  const [subjectRound, setSubjectRound] = useState(null);
  const [schoolBranding, setSchoolBranding] = useState(null);
  const [position, setPosition] = useState("WR");
  const [inputs, setInputs] = useState({});
  const [strengths, setStrengths] = useState([]);
  const [weaknesses, setWeaknesses] = useState([]);
  // Community mention counts for a loaded player's traits (findComps'
  // traitCounts) — weights the match toward their most-tagged traits.
  const [traitCounts, setTraitCounts] = useState(null);
  const [traitGroups, setTraitGroups] = useState({});
  const [heightWindow, setHeightWindow] = useState("1");
  const [traitWeight, setTraitWeight] = useState(String(TRAIT_WEIGHT));
  const [classMode, setClassMode] = useState("recommended"); // "recommended" | "custom"
  const [fromYear, setFromYear] = useState("");
  const [toYear, setToYear] = useState("");
  const [loadStatus, setLoadStatus] = useState("");
  const [slugNotFound, setSlugNotFound] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  // abbr -> nfl/{abbr} doc data, fetched lazily as top-3 results reference
  // them and cached for the rest of the session (see the effect below).
  const [nflBranding, setNflBranding] = useState({});
  const nflBrandingCache = useRef({});
  // Collapsed the instant a search has run (auto-preload or manual) — the
  // results are the point of the page, not the form. Starts open only when
  // there's nothing preloaded and so nothing else to show yet.
  const [calcOpen, setCalcOpen] = useState(!routeSlug);
  const loadSeq = useRef(0);
  // Top-3 card currently showing its detail side — hover on mouse, tap to
  // toggle on touch (lastPointerType tells the two apart, so a mouse click
  // right after hovering doesn't immediately flip the card back).
  const [activeCard, setActiveCard] = useState(null);
  const calcRef = useRef(null);
  // Measurement chip currently showing its percentile (hover on mouse, tap
  // to toggle on touch — same pointer-type split as the top-3 cards).
  const [activeChip, setActiveChip] = useState(null);
  // The 3-column grid — MarginAds centers its side rails in the gutters
  // outside this element, same as PlayerProfile.js's mainGridRef.
  const mainGridRef = useRef(null);
  // Right column — the loaded prospect's own Videos + In The News, same
  // cards as their player page (see components/PlayerSidebars.js).
  const { news: sidebarNews, videos: sidebarVideos, watchClips } = usePlayerSidebarData(loadedPlayer);
  const lastPointerType = useRef("mouse");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  // Below STACK_BELOW the 260 | 800 | 260 grid (+ 60px side padding + gaps)
  // would crush the middle column (~220px at a 900px tablet), so the page
  // stacks into one centered column — class dropdown, main, right column —
  // same order as mobile. isMobile still separately drives phone sizing.
  const [isStacked, setIsStacked] = useState(() => typeof window !== "undefined" && window.innerWidth < STACK_BELOW);
  const [classList, setClassList] = useState(null); // null = loading / nothing loaded

  useEffect(() => {
    const onResize = () => { setIsMobile(window.innerWidth < 768); setIsStacked(window.innerWidth < STACK_BELOW); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Feature flag gate ──
  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, "config", "features"))
      .then((snap) => { if (!cancelled) { setFeatureEnabled(!!snap.exists() && snap.data().comparisonEnabled === true); setFeatureChecked(true); } })
      .catch((e) => { console.error("Comparison feature-flag fetch error:", e); if (!cancelled) { setFeatureEnabled(false); setFeatureChecked(true); } });
    return () => { cancelled = true; };
  }, []);

  // Search list on demand (see fetchActivePlayers) — first focus or
  // keystroke in the search box triggers the one read.
  const searchRequested = useRef(false);
  const requestSearchList = () => {
    if (searchRequested.current) return;
    searchRequested.current = true;
    fetchActivePlayers()
      .then((rows) => setActivePlayers(rows))
      .catch((e) => { searchRequested.current = false; console.error("Comparison active-players fetch error:", e); });
  };

  // Pools this page needs right now: the calculator's selected position
  // (drives the Draft Classes list) and the last search's position (drives
  // results/percentiles) — usually the same one. A /comparison/:slug visit
  // waits for the prospect to resolve first, so it never reads the default
  // "WR" pool for, say, a QB.
  const awaitingSlug = !!routeSlug && !loadedPlayer && !slugNotFound;
  const neededPositions = awaitingSlug ? [] : [...new Set([position, submitted?.position].filter(Boolean))];
  useEffect(() => {
    if (!featureChecked || !featureEnabled) return;
    let cancelled = false;
    neededPositions.filter((pos) => !(pos in poolByPos)).forEach((pos) => {
      fetchPositionPool(pos)
        .then((rows) => { if (!cancelled) setPoolByPos((prev) => ({ ...prev, [pos]: rows })); })
        .catch((e) => { console.error("Comparison pool fetch error:", e); if (!cancelled) setPoolByPos((prev) => ({ ...prev, [pos]: [] })); });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureChecked, featureEnabled, neededPositions.join("|")]);
  const pool = poolByPos[position] || null; // calculator's selected position
  const resultsPool = submitted ? (poolByPos[submitted.position] || null) : null;

  const cutoffYear = compCutoffYear(loadedPlayer);
  const years = useMemo(() => gradedClassYears(pool, cutoffYear), [pool, cutoffYear]);
  const recWindow = useMemo(() => recommendedCompWindow(pool, cutoffYear), [pool, cutoffYear]);
  const effectiveFromYear = fromYear || defaultFromYear(years, recWindow);
  const effectiveToYear = toYear || years[years.length - 1] || "";

  // Loaded prospect's own school colors — same schools/{School} source
  // PlayerProfile.js's hero reads (Color1/Color2), so this page reads as
  // that player's own page instead of a generic tool.
  useEffect(() => {
    if (!loadedPlayer?.School) { setSchoolBranding(null); return; }
    let cancelled = false;
    getDocs(query(collection(db, "schools"), where("School", "==", loadedPlayer.School)))
      .then((snap) => { if (!cancelled) setSchoolBranding(snap.empty ? null : snap.docs[0].data()); })
      .catch((e) => { console.error("Comparison school-branding fetch error:", e); if (!cancelled) setSchoolBranding(null); });
    return () => { cancelled = true; };
  }, [loadedPlayer?.School]);
  useEffect(() => {
    if (!loadedPlayer?.Eligible || !loadedPlayer?.Position) { setClassList(null); return; }
    let cancelled = false;
    setClassList(null);
    fetchClassList(loadedPlayer.Eligible, loadedPlayer.Position)
      .then((list) => { if (!cancelled) setClassList(list); })
      .catch((e) => { console.error("Comparison class list fetch error:", e); if (!cancelled) setClassList([]); });
    return () => { cancelled = true; };
  }, [loadedPlayer?.Eligible, loadedPlayer?.Position]);

  // Same fallbacks as PlayerProfile.js (site blue/gold) when there's no
  // loaded prospect or their school has no colors on file.
  // ── Drafted prospect (a class that's already had its draft — i.e. 2026
  // for now): the hero mirrors their player page's drafted look —
  // drafting team's colors, NFL logo pinned left, college logo pinned
  // right, no faded school wordmark, plus the "Round 1 · Pick 1" pill.
  // One draftOrder read (Selection == Slug, same lookup PlayerProfile.js
  // uses), then the team's nfl/{abbr} doc (usually already cached by the
  // result cards' branding). Skipped entirely for still-undrafted classes.
  const [drafted, setDrafted] = useState(null); // { team, round, pick, branding }
  useEffect(() => {
    const year = parseInt(loadedPlayer?.Eligible, 10);
    if (!loadedPlayer?.Slug || !(year <= Number(LATEST_DRAFT_YEAR))) { setDrafted(null); return; }
    let cancelled = false;
    setDrafted(null);
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "draftOrder"), where("Selection", "==", loadedPlayer.Slug)));
        if (snap.empty || cancelled) return;
        const d = snap.docs[0].data();
        let branding = nflBrandingCache.current[d.Team];
        if (branding === undefined) {
          const t = await getDoc(doc(db, "nfl", d.Team));
          branding = t.exists() ? t.data() : null;
          nflBrandingCache.current[d.Team] = branding;
        }
        if (!cancelled) setDrafted({ team: d.Team, round: d.Round, pick: d.Pick, branding });
      } catch (e) {
        console.error("Comparison drafted-by lookup error:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [loadedPlayer?.Slug, loadedPlayer?.Eligible]);

  // ── We-Draft.com Select — an admin hand-picked top comp (players/{id}.
  // WeDraftSelect = { id: historical doc id, label }, set from the admin
  // Player Data editor). Rare by design: most prospects don't have one.
  // When set it always leads the results as card #1, shows the We-Draft
  // mark instead of a match %, and is fetched straight from `historical`
  // (one read) since the comp snapshots carry no doc ids.
  const [selectRecord, setSelectRecord] = useState(null);
  const selectId = loadedPlayer?.WeDraftSelect?.id || "";
  useEffect(() => {
    if (!selectId) { setSelectRecord(null); return; }
    let cancelled = false;
    getDoc(doc(db, "historical", selectId))
      .then((snap) => { if (!cancelled) setSelectRecord(snap.exists() ? { id: snap.id, ...snap.data() } : null); })
      .catch((e) => { console.error("Comparison We-Draft Select fetch error:", e); if (!cancelled) setSelectRecord(null); });
    return () => { cancelled = true; };
  }, [selectId]);

  const heroColor1 = (drafted?.branding?.Color1) || schoolBranding?.Color1 || BLUE;
  const heroColor2 = (drafted?.branding?.Color2) || schoolBranding?.Color2 || GOLD;

  // Fills measurements + community traits from a player doc, then runs the
  // search immediately — this is the "preloaded" path from PlayerProfile.js.
  const loadPlayer = async (player) => {
    const seq = ++loadSeq.current;
    setLoadedPlayer(player);
    setPlayerSearch("");
    setSearchOpen(false);
    const nextInputs = {};
    STAT_METRICS.forEach((m) => { const { value } = readMetric(player, m); if (value != null) nextInputs[m.key] = String(value); });
    setPosition(player.Position);
    setInputs(nextInputs);
    setStrengths([]);
    setWeaknesses([]);
    setTraitCounts(null);
    setSubjectRound(null);
    setLoadStatus("Loading traits…");
    navigate(`/comparison/${player.Slug}`, { replace: true });
    try {
      // Drafted classes: the real round (same draftOrder lookup as the hero
      // below), fetched alongside the evals so the first result set already
      // has it rather than re-sorting when it lands.
      const year = parseInt(player.Eligible, 10);
      const [evalsSnap, draftSnap] = await Promise.all([
        getDocs(collection(db, "players", player.id, "evaluations")),
        player.Slug && year <= Number(LATEST_DRAFT_YEAR)
          ? getDocs(query(collection(db, "draftOrder"), where("Selection", "==", player.Slug))).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (seq !== loadSeq.current) return;
      const evals = evalsSnap.docs.map((d) => d.data());
      const t = communityTraits(evals);
      const actualRound = draftSnap && !draftSnap.empty ? parseInt(draftSnap.docs[0].data().Round, 10) : NaN;
      const round = Number.isFinite(actualRound) ? actualRound : projectedRound(evals);
      setSubjectRound(round);
      setStrengths(t.strengths);
      setWeaknesses(t.weaknesses);
      setTraitCounts(t.counts);
      setLoadStatus("");
      // Auto-run once traits are in, using the values/traits we just set.
      setSubmitted({
        position: player.Position,
        values: Object.fromEntries(Object.entries(nextInputs).map(([k, v]) => [k, Number(v)])),
        strengths: t.strengths, weaknesses: t.weaknesses, traitCounts: t.counts,
        heightWindowSd: heightWindow ? Number(heightWindow) : null, traitWeight: Number(traitWeight),
        classMode, fromYear, toYear, beforeYear: compCutoffYear(player), subjectRound: round,
        selectFor: player.WeDraftSelect?.id || null,
      });
      setCalcOpen(false);
    } catch (e) {
      console.error("Comparison traits fetch error:", e);
      if (seq === loadSeq.current) setLoadStatus("Couldn't load traits.");
    }
  };

  // Resolve a route slug (direct link or PlayerProfile button) into a full
  // player doc + load it. Only runs when the slug actually changes and
  // isn't already the loaded player (loadPlayer itself updates the URL to
  // match, so this doesn't loop).
  useEffect(() => {
    if (!featureChecked || !featureEnabled) return;
    if (!routeSlug || loadedPlayer?.Slug === routeSlug) return;
    let cancelled = false;
    getDocs(query(collection(db, "players"), where("Slug", "==", routeSlug))).then((snap) => {
      if (cancelled) return;
      if (snap.empty) { setSlugNotFound(true); setLoadStatus("Player not found."); return; }
      setSlugNotFound(false);
      loadPlayer({ id: snap.docs[0].id, ...snap.docs[0].data() });
    }).catch((e) => console.error("Comparison slug lookup error:", e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureChecked, featureEnabled, routeSlug]);

  const playerOptions = useMemo(() => {
    const q = playerSearch.trim().toLowerCase();
    if (!q) return [];
    return activePlayers
      .filter((p) => `${p.First || ""} ${p.Last || ""} ${p.School || ""}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [activePlayers, playerSearch]);

  const showSearchResults = searchOpen && playerOptions.length > 0;
  useLayoutEffect(() => {
    if (!showSearchResults) return;
    const measure = () => {
      const el = searchInputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setSearchRect({ top: r.bottom + 6, left: r.left, width: r.width });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [showSearchResults]);

  const changePosition = (p) => { setPosition(p); setStrengths([]); setWeaknesses([]); setTraitCounts(null); };
  const toggleTrait = (trait, kind) => {
    const [list, setList, other] = kind === "Strengths" ? [strengths, setStrengths, weaknesses] : [weaknesses, setWeaknesses, strengths];
    if (other.includes(trait)) return;
    if (list.includes(trait)) setList(list.filter((t) => t !== trait));
    else if (list.length < 5) setList([...list, trait]);
  };
  const setPart = (metric, part, value) => {
    const picker = COMP_PICKERS[metric.format];
    setInputs((prev) => {
      const next = { ...picker.decompose(prev[metric.key]), [part]: value === "" ? "" : Number(value) };
      return { ...prev, [metric.key]: picker.recompose(next) };
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [posSnap, genSnap] = await Promise.all([getDoc(doc(db, "traits", position)), getDoc(doc(db, "traits", "Generic"))]);
        const g = {};
        // Group labels match the admin pickers' (HistoricalSection etc.).
        if (posSnap.exists()) g["Position Specific"] = (posSnap.data().traits || []).sort();
        if (genSnap.exists()) g["Generic"] = (genSnap.data().traits || []).sort();
        if (!cancelled) setTraitGroups(g);
      } catch (e) { console.error("Comparison traits fetch error:", e); if (!cancelled) setTraitGroups({}); }
    })();
    return () => { cancelled = true; };
  }, [position]);

  const parsed = useMemo(() => {
    const out = {};
    STAT_METRICS.forEach((m) => {
      const raw = (inputs[m.key] || "").trim();
      if (!raw) return;
      const num = Number(raw);
      out[m.key] = Number.isFinite(num) && num >= m.min && num <= m.max ? { value: num } : { error: true };
    });
    return out;
  }, [inputs]);
  const hasError = Object.values(parsed).some((p) => p.error);
  const values = Object.fromEntries(Object.entries(parsed).filter(([, p]) => !p.error).map(([k, p]) => [k, p.value]));
  const filledCount = Object.keys(values).length;
  const hasTraits = Number(traitWeight) > 0 && strengths.length + weaknesses.length > 0;
  const canSearch = !hasError && (filledCount > 0 || hasTraits);

  // Class mode/range is snapshotted into `submitted` (like every other
  // input) so results only change on an explicit search, not live as the
  // selects move. Recommended resolves its window here; a custom range's
  // blank from/to resolves to its defaults (see gradedClassYears/
  // defaultFromYear), against the pool as it is now. Either way the class
  // choice only narrows the *candidates*: the SDs that score them come from
  // every drafted player before the prospect's class, so picking a narrower
  // range never changes how a measurement difference is scored.
  const results = useMemo(() => {
    if (!submitted || !resultsPool) return [];
    const before = submitted.beforeYear;
    const statsPool = before == null ? resultsPool : resultsPool.filter((r) => Number(r.Year) < before);
    const win = recommendedCompWindow(resultsPool, before);
    let candidates;
    if (submitted.classMode === "custom") {
      const classYears = gradedClassYears(resultsPool, before);
      const from = Number(submitted.fromYear || defaultFromYear(classYears, win) || 0);
      const to = Number(submitted.toYear || classYears[classYears.length - 1] || 9999);
      candidates = statsPool.filter((r) => Number(r.Year) >= from && Number(r.Year) <= to);
    } else {
      const allowDoubleExtended = doubleExtendedFor(submitted.subjectRound);
      candidates = statsPool.filter((r) => inRecommendedWindow(r, win, { allowDoubleExtended }));
    }
    const input = { position: submitted.position, values: submitted.values, strengths: submitted.strengths, weaknesses: submitted.weaknesses, traitCounts: submitted.traitCounts };
    const stats = computePositionStats(statsPool);
    const comps = findComps(input, candidates, stats,
      { heightWindowSd: submitted.heightWindowSd, traitWeight: submitted.traitWeight, limit: 10, subjectRound: submitted.subjectRound }
    );
    // We-Draft.com Select leads, whatever the model thinks — scored the
    // same way only so its card's detail face has measurements and shared
    // traits to show (no height window or class range: it was hand-picked).
    // Only for the prospect it was picked for, at their own position.
    if (!selectRecord || !submitted.selectFor || submitted.selectFor !== selectRecord.id || selectRecord.Position !== submitted.position) return comps;
    const scored = findComps(input, [selectRecord], stats, { heightWindowSd: null, traitWeight: submitted.traitWeight, limit: 1, requireTraits: false, allowSelectOnly: true })[0];
    const values = Object.fromEntries(STAT_METRICS.map((m) => [m.key, readMetric(selectRecord, m).value]));
    const select = {
      ...(scored || { record: selectRecord, values }),
      select: true,
      traits: scored?.traits || { strengths: selectRecord.Strengths || [], weaknesses: selectRecord.Weaknesses || [], sharedStrengths: [], sharedWeaknesses: [] },
    };
    const sameAsSelect = (r) => recordName(r.record) === recordName(selectRecord) && String(r.record.Year) === String(selectRecord.Year);
    return [select, ...comps.filter((r) => !sameAsSelect(r))].slice(0, 10);
  }, [submitted, resultsPool, selectRecord]);

  // Each result's actual NFL team colors/logo (nfl/{abbr}) — the top-3
  // cards' color treatment and the 4-10 table's logos. Fetched lazily per
  // abbreviation and cached for the session — at most 10 new reads per
  // search, usually far fewer once common teams have shown up.
  useEffect(() => {
    const abbrs = [...new Set(results.map((r) => resolveNflAbbr(r.record["NFL Team"])).filter(Boolean))];
    const missing = abbrs.filter((a) => !(a in nflBrandingCache.current));
    if (!missing.length) return;
    Promise.all(missing.map((a) => getDoc(doc(db, "nfl", a)).then((snap) => { nflBrandingCache.current[a] = snap.exists() ? snap.data() : null; })))
      .then(() => setNflBranding({ ...nflBrandingCache.current }))
      .catch((e) => console.error("Comparison NFL-branding fetch error:", e));
  }, [results]);

  // Percentile baseline for the measurement chips — every drafted player at
  // the position (historical + latest class) from classes before the
  // prospect's own, never the class-range subset a search may have
  // narrowed to, so "88th percentile" always means the same thing.
  // Same before-their-class cutoff as the comps themselves.
  const percentileStats = useMemo(() => {
    if (!resultsPool) return {};
    const before = submitted?.beforeYear;
    return computePositionStats(before == null ? resultsPool : resultsPool.filter((r) => Number(r.Year) < before));
  }, [resultsPool, submitted?.beforeYear]);

  // A new result set shouldn't open with some card already flipped.
  useEffect(() => { setActiveCard(null); }, [results]);

  const runSearch = () => {
    if (!canSearch) return;
    setSubmitted({ position, values, strengths, weaknesses, traitCounts, heightWindowSd: heightWindow ? Number(heightWindow) : null, traitWeight: Number(traitWeight), classMode, fromYear, toYear, beforeYear: cutoffYear, subjectRound: loadedPlayer ? subjectRound : null, selectFor: loadedPlayer?.WeDraftSelect?.id || null });
    setCalcOpen(false);
  };
  const clearAll = () => {
    loadSeq.current += 1;
    setLoadedPlayer(null); setSubjectRound(null); setInputs({}); setStrengths([]); setWeaknesses([]); setTraitCounts(null); setSubmitted(null); setLoadStatus(""); setCalcOpen(true);
    navigate("/comparison", { replace: true });
  };

  // ── SEO. This page targets "<player> NFL comparison / player comps /
  // measurements / similar NFL players"; the player page keeps "draft
  // projection / scouting report", so none of that language is used here,
  // and the canonical is this page's own URL, never /player/<slug>.
  // Everything player-specific is derived from loadedPlayer only (no
  // "undefined undefined" before it loads). Indexability follows the
  // route, though, not loadedPlayer: /comparison/:slug is index,follow from
  // first render — including while the player is still loading — since a
  // crawler catching a transient noindex could drop the page. The blank
  // /comparison calculator is indexable too (it's the landing page for
  // "NFL player comparison" searches); only a slug that doesn't resolve is
  // noindex,follow. ──
  const seoName = loadedPlayer ? `${loadedPlayer.First || ""} ${loadedPlayer.Last || ""}`.trim() : "";
  const seoSlug = loadedPlayer?.Slug || routeSlug || "";
  const seoHeading = seoName ? `${seoName} NFL Player Comparison and Measurements` : "NFL Player Comparisons and Measurements";
  const seoTitle = `${seoHeading} | We-Draft`;
  const seoDescription = seoName
    ? `Compare ${seoName} to similar NFL players using physical measurements, athletic testing, playing traits, and historical draft data.`
    : "Compare college football prospects to similar NFL players using measurements, athletic testing, playing traits, and historical draft data.";
  const seoUrl = seoSlug ? `${SITE_URL}/comparison/${seoSlug}` : `${SITE_URL}/comparison`;
  const seoIndexable = !slugNotFound;
  // Social image: the school logo this page's own hero already shows (there
  // is no player photo in the data model — same reasoning as
  // PlayerProfile.js's Helmet), falling back to the site logo like
  // TeamPage.js's og:image does.
  const seoImage = (schoolBranding?.Logo1 && sanitizeUrl(schoolBranding.Logo1)) || `${SITE_URL}/logo512.png`;
  const seoHead = (
    <Helmet>
      <title>{seoTitle}</title>
      <meta name="description" content={seoDescription} />
      <meta name="robots" content={seoIndexable ? "index, follow" : "noindex, follow"} />
      <link rel="canonical" href={seoUrl} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={seoTitle} />
      <meta property="og:description" content={seoDescription} />
      <meta property="og:url" content={seoUrl} />
      <meta property="og:site_name" content="We-Draft.com" />
      <meta property="og:image" content={seoImage} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={seoTitle} />
      <meta name="twitter:description" content={seoDescription} />
      <meta name="twitter:image" content={seoImage} />
      {/* Home → Player Comparisons → Player, player pages only. No
          breadcrumb UI exists on this page, so this is data only. */}
      {seoName && (
        <script type="application/ld+json">{jsonLd({
          "@context": "https://schema.org", "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": `${SITE_URL}/` },
            { "@type": "ListItem", "position": 2, "name": "Player Comparisons", "item": `${SITE_URL}/comparison` },
            { "@type": "ListItem", "position": 3, "name": seoName, "item": seoUrl },
          ],
        })}</script>
      )}
      {/* WebPage — only facts the page actually has (no ratings, author, or
          dates); "about" is the prospect the comparison is for. */}
      {seoName && (
        <script type="application/ld+json">{jsonLd({
          "@context": "https://schema.org", "@type": "WebPage",
          "name": seoHeading,
          "description": seoDescription,
          "url": seoUrl,
          "about": {
            "@type": "Person",
            "name": seoName,
            ...(loadedPlayer.School ? { "affiliation": { "@type": "SportsTeam", "name": loadedPlayer.School } } : {}),
          },
        })}</script>
      )}
    </Helmet>
  );

  if (featureChecked && !featureEnabled) return <Navigate to="/" replace />;
  if (!featureChecked || Object.keys(poolByPos).length === 0) return <>{seoHead}<LoadingSpinner label="Loading" size={48} minHeight="60vh" /></>;

  const metricByKey = Object.fromEntries(STAT_METRICS.map((m) => [m.key, m]));
  const submittedMetrics = submitted ? STAT_METRICS.filter((m) => submitted.values[m.key] != null) : [];
  const top3 = results.slice(0, 3);
  const rest = results.slice(3);

  const renderMetric = (key) => {
    const m = metricByKey[key];
    const p = parsed[m.key];
    const selectStyle = { ...inputStyle, flex: 1, padding: "7px 6px", fontSize: "12px", ...(p?.error ? { border: "2px solid #c0392b" } : {}) };
    let control;
    if (m.format === "height") {
      const { feet, inches, eighths } = decomposeHeight(inputs.height);
      control = (
        <div style={{ display: "flex", gap: "5px" }}>
          <select value={feet} onChange={(e) => setPart(m, "feet", e.target.value)} style={selectStyle}><option value="">Ft</option>{[4, 5, 6, 7].map((f) => <option key={f} value={f}>{f}'</option>)}</select>
          <select value={inches} onChange={(e) => setPart(m, "inches", e.target.value)} style={selectStyle}><option value="">In</option>{Array.from({ length: 12 }, (_, i) => i).map((i) => <option key={i} value={i}>{i}"</option>)}</select>
          <select value={eighths} onChange={(e) => setPart(m, "eighths", e.target.value)} style={selectStyle}>{[0, 1, 2, 3, 4, 5, 6, 7].map((e2) => <option key={e2} value={e2}>{EIGHTHS_FRACTION_LABEL[e2] || "0"}</option>)}</select>
        </div>
      );
    } else if (m.format === "inches") {
      const { whole, eighths } = decomposeInches(inputs[m.key]);
      control = (
        <div style={{ display: "flex", gap: "5px" }}>
          <select value={whole} onChange={(e) => setPart(m, "whole", e.target.value)} style={selectStyle}><option value="">In</option>{Array.from({ length: Math.floor(m.max) - Math.floor(m.min) + 1 }, (_, i) => i + Math.floor(m.min)).map((i) => <option key={i} value={i}>{i}"</option>)}</select>
          <select value={eighths} onChange={(e) => setPart(m, "eighths", e.target.value)} style={selectStyle}>{[0, 1, 2, 3, 4, 5, 6, 7].map((e2) => <option key={e2} value={e2}>{EIGHTHS_FRACTION_LABEL[e2] || "0"}</option>)}</select>
        </div>
      );
    } else if (m.format === "feetInches") {
      const { feet, inches } = decomposeFeetInches(inputs[m.key]);
      control = (
        <div style={{ display: "flex", gap: "5px" }}>
          <select value={feet} onChange={(e) => setPart(m, "feet", e.target.value)} style={selectStyle}><option value="">Ft</option>{Array.from({ length: 8 }, (_, i) => i + 6).map((f) => <option key={f} value={f}>{f}'</option>)}</select>
          <select value={inches} onChange={(e) => setPart(m, "inches", e.target.value)} style={selectStyle}><option value="">In</option>{Array.from({ length: 12 }, (_, i) => i).map((i) => <option key={i} value={i}>{i}"</option>)}</select>
        </div>
      );
    } else {
      control = (
        <input
          value={inputs[m.key] || ""}
          onChange={(e) => setInputs((prev) => ({ ...prev, [m.key]: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
          style={p?.error ? { ...inputStyle, border: "2px solid #c0392b" } : inputStyle}
        />
      );
    }
    return (
      <div key={m.key} style={m.format === "feetInches" ? { gridColumn: "1 / -1" } : undefined}>
        <div style={{ ...labelStyle, color: p?.error ? "#c0392b" : "#888" }}>{m.label}{m.unit ? ` (${m.unit})` : ""}</div>
        {control}
      </div>
    );
  };

  // ── Left-margin class list — same rows as PlayerProfile.js's Draft Class
  // sidebar (grade badge + name/school, the loaded prospect highlighted),
  // except every row opens that classmate's comparison page instead of
  // their player page. Capped at DRAFT_CLASS_LIMIT, with the loaded
  // prospect appended if they rank below the cap. ──
  const classLabel = loadedPlayer ? `${formatEligible(loadedPlayer.Eligible)} ${loadedPlayer.Position}` : "";
  const selfIndex = classList ? classList.findIndex((p) => p.id === loadedPlayer?.id) : -1;
  const classDraftMode = !!classList && classList.some((p) => p.draftPick != null);
  const classRows = !classList ? [] : selfIndex >= DRAFT_CLASS_LIMIT
    ? [...classList.slice(0, DRAFT_CLASS_LIMIT), classList[selfIndex]]
    : classList.slice(0, DRAFT_CLASS_LIMIT);
  const classListBody = !classList ? (
    <LoadingSpinner label="Loading" size={24} minHeight="60px" />
  ) : classRows.length === 0 ? (
    <div style={{ padding: "16px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>No other prospects yet.</div>
  ) : classRows.map((p, i) => {
    const isSelf = p.id === loadedPlayer?.id;
    const gradeLabel = p.avgGrade != null ? gradeLabels[Math.round(p.avgGrade)] : "Watchlist";
    const gd = gradeDisplay(gradeLabel);
    // Drafted class (rows carry picks, already in pick order): drafting
    // team's logo in place of the grade badge, "Round 1 Pick 15" in place
    // of the school — same as PlayerProfile.js's sidebar.
    const draftMode = classDraftMode;
    const draftLine = p.draftPick != null ? `Round ${p.draftRound} Pick ${p.draftPick}` : "Undrafted";
    const rowStyle = {
      display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", textDecoration: "none",
      borderBottom: i < classRows.length - 1 ? "1px solid #f0f0f0" : "none",
      background: isSelf ? "#fff8e6" : "#fff",
      borderLeft: isSelf ? `4px solid ${GOLD}` : "4px solid transparent",
    };
    const content = (
      <>
        {draftMode ? (
          <div title={p.draftTeam ? displayTeamName(p.draftTeam) : "Undrafted"} style={{ flexShrink: 0, width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {p.teamLogo ? (
              <img src={sanitizeUrl(p.teamLogo)} alt={displayTeamName(p.draftTeam)} style={{ width: "28px", height: "28px", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
            ) : (
              <span style={{ color: "#ccc", fontWeight: 900, fontSize: "14px" }}>—</span>
            )}
          </div>
        ) : (
          <div
            title={gradeLabel}
            style={{
              flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              width: "28px", height: "28px", borderRadius: "5px", backgroundColor: gd.bg, border: `2px solid ${gd.border}`,
              color: "#fff", fontSize: "10px", fontWeight: 900,
            }}
          >
            {gd.short}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{ color: BLUE, fontWeight: 900, fontSize: "14px", lineHeight: 1.2 }}>{p.First} {p.Last}</span>
          <span style={{ color: "#777", fontWeight: 700, fontSize: "12px", marginTop: "2px" }}>{draftMode ? draftLine : (p.School || "—")}</span>
        </div>
      </>
    );
    return isSelf ? (
      <div key={p.id} style={rowStyle}>{content}</div>
    ) : (
      <Link
        key={p.id} to={`/comparison/${p.Slug}`} style={rowStyle}
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#f7f9fc"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
      >
        {content}
      </Link>
    );
  });
  const classCard = (
    <div style={{ border: `2px solid ${BLUE}`, borderRadius: "8px", overflow: "hidden" }}>
      <div style={{ backgroundColor: BLUE, padding: "12px 14px", textAlign: "center" }}>
        <h2 style={{ color: "#fff", fontSize: "20px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>{classLabel}</h2>
      </div>
      <div style={{ height: "4px", backgroundColor: GOLD }} />
      <div style={{ background: "#fff" }}>{classListBody}</div>
    </div>
  );
  const classDropdown = (
    <details style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
      <summary style={{ backgroundColor: BLUE, padding: "14px", cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", justifyContent: "space-between", userSelect: "none" }}>
        <h2 style={{ color: "#fff", fontWeight: 900, fontSize: "20px", letterSpacing: "0.04em", textTransform: "uppercase", margin: 0 }}>{classLabel} Class</h2>
        <span style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>View More</span>
      </summary>
      <div style={{ height: "4px", backgroundColor: GOLD }} />
      {classListBody}
    </details>
  );
  const schoolLogo = schoolBranding ? (schoolBranding.LogoDark || schoolBranding.Logo1 || "") : "";
  const nflLogo = drafted?.branding ? (drafted.branding.LogoDark || drafted.branding.Logo1 || "") : "";
  // Left logo: the drafting team's for a drafted prospect, else the school's.
  const heroLogo = drafted ? nflLogo : schoolLogo;
  // Same dark-background-variant preference as PlayerProfile.js's hero.
  const heroWatermark = schoolBranding ? (schoolBranding.WordmarkDark || schoolBranding.Wordmark || "") : "";

  return (
    <div style={{ background: "#f4f7fb", minHeight: "70vh", paddingBottom: "60px" }}>
      <style>{`
        @keyframes wdCompFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        /* We-Draft.com Select card — slow gold glow, a rotating gold ring
           around the WD mark, and a shine that sweeps the ribbon. */
        @keyframes wdSelectGlow { 0%, 100% { box-shadow: 0 0 0 0 rgba(244,166,30,0.0), 0 6px 26px rgba(0,48,92,0.22); } 50% { box-shadow: 0 0 22px 2px rgba(244,166,30,0.55), 0 6px 26px rgba(0,48,92,0.22); } }
        @keyframes wdSelectSpin { to { transform: rotate(360deg); } }
        @keyframes wdSelectShine { 0% { transform: translateX(-120%) skewX(-20deg); } 60%, 100% { transform: translateX(260%) skewX(-20deg); } }
        .wd-comp-card.wd-select-card { animation: wdCompFadeUp 0.4s ease both, wdSelectGlow 3.2s ease-in-out 0.4s infinite; }
        @media (prefers-reduced-motion: reduce) { .wd-select-card, .wd-select-ring, .wd-select-shine { animation: none !important; } }
        @keyframes wdCompSlideDown { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        .wd-comp-card { animation: wdCompFadeUp 0.35s ease both; }
        .wd-comp-form { animation: wdCompSlideDown 0.2s ease both; }
        .wd-comp-chip { transition: transform 0.12s ease, box-shadow 0.12s ease; }
        .wd-comp-chip:hover { transform: translateY(-1px); }
        .wd-comp-cta:hover { filter: brightness(1.08); }
        .wd-comp-search-row:hover { background: #f4f7fb; }
        .wd-comp-profile-btn:hover { background: rgba(255,255,255,0.28); }
        .wd-comp-toggle:hover { opacity: 0.75; }
        .wd-comp-hero-btn { transition: opacity 0.15s ease; }
        .wd-comp-hero-btn:hover { opacity: 0.9; }
        .wd-comp-hero-school:hover { text-decoration: underline !important; }
        .wd-comp-live:empty { display: none; }
        .wd-comp-row-link:hover { text-decoration: underline !important; }
        .wd-comp-more-row { transition: background 0.15s ease; }
        .wd-comp-more-row:hover { background: var(--wd-row-tint); }
        @keyframes wdPlayerHeroDrift { 0% { transform: translate(0, 0); } 100% { transform: translate(-80px, -46px); } }
        @keyframes wdPlayerHeroSpotlight { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
        .wd-hero-logo-link { cursor: pointer; }
        .wd-hero-logo-img { transition: transform 0.2s ease, filter 0.2s ease; }
        .wd-hero-logo-link:hover .wd-hero-logo-img { transform: scale(1.08); filter: drop-shadow(0 6px 20px rgba(0,0,0,0.55)) brightness(1.1); }
      `}</style>
      {seoHead}

      {/* Desktop: the exact PlayerProfile.js grid — 1600px max, 60px side
          padding (room for margin ads outside it), 260px | ≤800px | 260px
          centered. The class list is the left 260px column, hanging off
          the calculator's left edge; the right one is reserved (empty for
          now) for a future right bar, so the center never shifts when it's
          added.
          Mobile/tablet (isStacked): single centered column, class list
          collapses to a dropdown above the hero, right column below the
          main content, same order as the player page's mobile layout. */}
      <div ref={mainGridRef} style={
        isStacked
          ? { maxWidth: "800px", margin: "0 auto", padding: isMobile ? "14px 12px 40px" : "24px 24px 60px", display: "flex", flexDirection: "column", gap: loadedPlayer ? "16px" : 0 }
          : { maxWidth: "1600px", margin: "0 auto", padding: "24px 60px 160px", display: "grid", gridTemplateColumns: "260px minmax(0, 800px) 260px", gap: "18px", alignItems: "start", justifyContent: "center" }
      }>
      {isStacked
        ? (loadedPlayer && classDropdown)
        : <div style={{ position: "sticky", top: "20px", width: "260px", justifySelf: "end" }}>{loadedPlayer && classCard}</div>}
      <div style={{ minWidth: 0 }}>

      {/* ── Hero card — a copy of PlayerProfile.js's HERO CARD, same
          structure and styling: flat color1 toolbar (Back left, pill
          buttons right), then the gradient band (color2 corner glows over a
          darkened color1→color2 sweep, drifting stripe texture + breathing
          spotlight, faded school wordmark bleeding off the right, school
          logo pinned left as a full-opacity background layer), stacked
          all-caps name + position/school/class
          row centered, closed by a color2 bar. Themed with the loaded
          prospect's school colors; site blue/gold before anyone's loaded.
          Differences: no flair badge box on the right, and the prospect
          search added under the name row. ── */}
      <div style={{ marginBottom: "24px", borderRadius: "8px", overflow: "hidden", border: `3px solid ${heroColor1}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", backgroundColor: heroColor1, padding: isMobile ? "10px 12px" : "12px 20px" }}>
          <button
            onClick={() => navigate(-1)}
            style={{ border: "2px solid #fff", background: "rgba(255,255,255,0.12)", color: "#fff", fontWeight: 800, fontSize: isMobile ? "14px" : "16px", padding: isMobile ? "7px 12px" : "10px 22px", borderRadius: "8px", cursor: "pointer", letterSpacing: "0.04em", whiteSpace: "nowrap", flexShrink: 0, alignSelf: "flex-start" }}
          >
            ← Back
          </button>
          {loadedPlayer && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", rowGap: "6px", justifyContent: "flex-end" }}>
              {/* Same Watch button as the player page's toolbar — renders
                  nothing unless the prospect has at least one Short. */}
              <WatchButton
                clips={watchClips}
                color1={heroColor1}
                color2={heroColor2}
                isMobile={isMobile}
                originPlayer={{
                  id: loadedPlayer.id,
                  name: `${loadedPlayer.First || ""} ${loadedPlayer.Last || ""}`.trim(),
                  slug: loadedPlayer.Slug || "",
                  position: loadedPlayer.Position || "",
                  school: loadedPlayer.School || "",
                  eligible: loadedPlayer.Eligible || "",
                }}
              />
              <button
                onClick={clearAll}
                className="wd-comp-hero-btn"
                style={{ border: "2px solid #fff", background: "rgba(255,255,255,0.12)", color: "#fff", fontWeight: 900, fontSize: isMobile ? "14px" : "16px", padding: isMobile ? "7px 14px" : "9px 18px", borderRadius: "999px", cursor: "pointer" }}
              >
                {isMobile ? "New" : "Compare Someone Else"}
              </button>
              <Link
                to={`/player/${loadedPlayer.Slug}`}
                className="wd-comp-hero-btn"
                style={{ backgroundColor: heroColor2, border: "2px solid #fff", color: "#fff", fontWeight: 900, fontSize: isMobile ? "14px" : "16px", padding: isMobile ? "7px 14px" : "9px 18px", borderRadius: "999px", textDecoration: "none" }}
              >
                {isMobile ? "Scouting Report" : "View Scouting Report"}
              </Link>
            </div>
          )}
        </div>

        <div style={{
          position: "relative", overflow: "hidden",
          background: [
            `radial-gradient(circle 220px at top left, ${heroColor2}55, transparent 100%)`,
            `radial-gradient(circle 220px at bottom right, ${heroColor2}55, transparent 100%)`,
            "linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4))",
            `linear-gradient(120deg, ${heroColor1} 0%, ${heroColor1} 55%, ${heroColor2} 100%)`,
          ].join(", "),
        }}>
          <div aria-hidden="true" style={{
            position: "absolute", inset: "-20%", zIndex: 0, pointerEvents: "none",
            background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 2px, transparent 2px, transparent 40px)",
            animation: "wdPlayerHeroDrift 18s linear infinite",
          }} />
          <div aria-hidden="true" style={{
            position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
            background: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.16), transparent 55%)",
            animation: "wdPlayerHeroSpotlight 5s ease-in-out infinite",
          }} />
          {loadedPlayer && heroWatermark && !isMobile && !drafted && (
            <img
              src={sanitizeUrl(heroWatermark)} alt="" aria-hidden="true"
              style={{
                position: "absolute", top: "50%", right: "-4%", transform: "translateY(-50%)",
                width: "55%", maxWidth: "520px", height: "auto", objectFit: "contain",
                opacity: 0.14, zIndex: 0, pointerEvents: "none",
              }}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          )}
          {/* Fixed pixel heights, matched to what PlayerProfile.js's hero
              logos actually render at — not its "% of the band" sizing: this
              band is taller (it also holds the prospect search, and on a
              phone the wrapped draft line), so the same %s came out ~25%
              bigger here. Drafted: NFL logo 164px / college 129px desktop,
              80 / 60px phone; undrafted: school logo 135px / 70px. */}
          {loadedPlayer && heroLogo && (() => {
            const wrapStyle = {
              position: "absolute", top: "50%", left: isMobile ? "4%" : "3%", transform: "translateY(-50%)",
              height: drafted ? (isMobile ? "80px" : "164px") : (isMobile ? "70px" : "135px"), zIndex: 2, display: "flex", alignItems: "center",
            };
            const img = (
              <img
                src={sanitizeUrl(heroLogo)} alt={loadedPlayer.School}
                className="wd-hero-logo-img"
                style={{ height: "100%", width: "auto", maxWidth: isMobile ? "90px" : "220px", objectFit: "contain", filter: "drop-shadow(0 4px 14px rgba(0,0,0,0.45))" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            );
            if (drafted) {
              return (
                <Link to={`/nfl/${drafted.team.toLowerCase()}`} aria-label={displayTeamName(drafted.team)} className="wd-hero-logo-link" style={wrapStyle}>{img}</Link>
              );
            }
            return schoolBranding?.Slug ? (
              <Link to={`/team/${schoolBranding.Slug}`} aria-label={loadedPlayer.School} className="wd-hero-logo-link" style={wrapStyle}>{img}</Link>
            ) : (
              <div style={{ ...wrapStyle, pointerEvents: "none" }}>{img}</div>
            );
          })()}
          {/* Drafted prospect: college logo pinned right — a smaller second
              background layer opposite the NFL logo, same sizing as
              PlayerProfile.js's heroCollegeLogo. */}
          {loadedPlayer && drafted && schoolLogo && (() => {
            const wrapStyle = {
              position: "absolute", top: "50%", right: isMobile ? "4%" : "3%", transform: "translateY(-50%)",
              height: isMobile ? "60px" : "129px", zIndex: 2, display: "flex", alignItems: "center",
            };
            const img = (
              <img
                src={sanitizeUrl(schoolLogo)} alt={loadedPlayer.School}
                className="wd-hero-logo-img"
                style={{ height: "100%", width: "auto", maxWidth: isMobile ? "70px" : "170px", objectFit: "contain", filter: "drop-shadow(0 4px 14px rgba(0,0,0,0.45))" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            );
            return schoolBranding?.Slug ? (
              <Link to={`/team/${schoolBranding.Slug}`} aria-label={loadedPlayer.School} className="wd-hero-logo-link" style={wrapStyle}>{img}</Link>
            ) : (
              <div style={{ ...wrapStyle, pointerEvents: "none" }}>{img}</div>
            );
          })()}
          <div style={{ position: "relative", zIndex: 1 }}>
            {/* pointerEvents none on the row (it spans the full width, over
                the pinned logo) — only the search opts back in, same idea
                as PlayerProfile.js's own name row. */}
            <div style={{ position: "relative", padding: isMobile ? "12px 10px 8px" : "20px 24px 10px", textAlign: "center", pointerEvents: "none" }}>
              {/* On a phone the pinned logo (up to ~90px at 4% in) sits
                  right where a longer centered name runs — inset the name
                  block by the logo's footprint on both sides (symmetric,
                  so it stays centered). The search below isn't inset. */}
              <div style={{ padding: isMobile && loadedPlayer && heroLogo ? "0 24%" : 0 }}>
              {loadedPlayer ? (
                <>
                  {/* H1 is the stacked name only (the page's visual
                      design); the full "NFL Player Comparison and
                      Measurements" phrasing lives in the <title>/meta
                      (seoHead) and the visible SEO section at the bottom of
                      the main column. The {" "} keeps the H1's text reading
                      "First Last" for crawlers even though the two lines
                      render as blocks. */}
                  <h1 style={{ fontSize: isMobile ? "clamp(20px, 6vw, 30px)" : "clamp(36px, 5vw, 58px)", fontWeight: 900, color: "#fff", margin: 0, lineHeight: 1, textTransform: "uppercase", letterSpacing: "0.02em", textShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
                    <span style={{ display: "block" }}>{loadedPlayer.First}</span>{" "}
                    <span style={{ display: "block", marginTop: isMobile ? "2px" : "4px" }}>{loadedPlayer.Last}</span>
                  </h1>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: isMobile ? "6px" : "10px", marginTop: "8px" }}>
                    <span style={{ background: "rgba(255,255,255,0.14)", border: "2px solid #fff", color: "#fff", fontWeight: 800, letterSpacing: "0.05em", fontSize: isMobile ? "11px" : "17px", padding: isMobile ? "2px 8px" : "3px 16px", borderRadius: "999px" }}>
                      {loadedPlayer.Position}
                    </span>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>·</span>
                    {schoolBranding?.Slug ? (
                      <Link to={`/team/${schoolBranding.Slug}`} className="wd-comp-hero-school" style={{ color: "#fff", fontWeight: 800, fontSize: isMobile ? "12px" : "19px", textShadow: "0 1px 4px rgba(0,0,0,0.4)", textDecoration: "none", pointerEvents: "auto" }}>
                        {loadedPlayer.School}
                      </Link>
                    ) : (
                      <span style={{ color: "#fff", fontWeight: 800, fontSize: isMobile ? "12px" : "19px", textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}>{loadedPlayer.School}</span>
                    )}
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>·</span>
                    <span style={{ color: "rgba(255,255,255,0.8)", fontWeight: 700, fontSize: isMobile ? "12px" : "19px" }}>{formatEligible(loadedPlayer.Eligible)}</span>
                  </div>
                  {/* Phones / tablets (no right column up top): the pulsing
                      Follow Live button while his team is playing. */}
                  {isStacked && (
                    <div className="wd-comp-live" style={{ display: "flex", justifyContent: "center", marginTop: "10px", pointerEvents: "auto" }}>
                      <PlayerLiveCard player={loadedPlayer} variant="button" />
                    </div>
                  )}
                  {/* Drafted: "Round 1 · Pick 1" pill + drafting team, same
                      as the player page's drafted hero line. */}
                  {drafted && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: isMobile ? "6px" : "10px", marginTop: "8px" }}>
                      <span style={{
                        background: heroColor2, border: "2px solid #fff", color: "#fff", borderRadius: "999px",
                        fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap",
                        fontSize: isMobile ? "11px" : "15px", padding: isMobile ? "2px 10px" : "3px 16px",
                        textShadow: "0 1px 3px rgba(0,0,0,0.25)",
                      }}>
                        Round {drafted.round} · Pick {drafted.pick}
                      </span>
                      <Link to={`/nfl/${drafted.team.toLowerCase()}`} className="wd-comp-hero-school" style={{ color: "#fff", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em", fontSize: isMobile ? "13px" : "18px", textShadow: "0 1px 4px rgba(0,0,0,0.4)", textDecoration: "none", pointerEvents: "auto" }}>
                        {displayTeamName(drafted.team)}
                      </Link>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <h1 style={{ fontSize: isMobile ? "clamp(20px, 6vw, 30px)" : "clamp(36px, 5vw, 58px)", fontWeight: 900, color: "#fff", margin: 0, lineHeight: 1, textTransform: "uppercase", letterSpacing: "0.02em", textShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
                    {seoHeading}
                  </h1>
                  <div style={{ fontSize: isMobile ? "12px" : "15px", fontWeight: 700, color: "rgba(255,255,255,0.8)", maxWidth: "520px", margin: "8px auto 0" }}>
                    Measurables and scouting traits, matched against every drafted player on record. Load a prospect or build your own.
                  </div>
                </>
              )}

              </div>

              {/* Search — primary action when nothing's loaded, secondary
                  once a prospect is (switching doesn't require a round
                  trip through Compare Someone Else first). */}
              <div style={{ maxWidth: "380px", margin: isMobile ? "10px auto 4px" : "14px auto 6px", position: "relative", zIndex: 3, pointerEvents: "auto" }}>
                <input
                  ref={searchInputRef}
                  value={playerSearch}
                  onChange={(e) => { requestSearchList(); setPlayerSearch(e.target.value); setSearchOpen(true); }}
                  onFocus={() => { requestSearchList(); setSearchOpen(true); }}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  placeholder="Search a prospect by name or school…"
                  style={{ width: "100%", border: "none", borderRadius: "999px", padding: "10px 18px", fontWeight: 700, fontSize: "13px", outline: "none", boxSizing: "border-box", boxShadow: "0 6px 24px rgba(0,0,0,0.25)" }}
                />
                {showSearchResults && searchRect && createPortal(
                  <div style={{
                    position: "fixed", top: searchRect.top, left: searchRect.left, width: searchRect.width, zIndex: 1000,
                    background: "#fff", borderRadius: "12px", boxShadow: "0 8px 30px rgba(0,0,0,0.25)", overflow: "hidden", textAlign: "left",
                  }}>
                    {playerOptions.map((p) => (
                      <div
                        key={p.id}
                        className="wd-comp-search-row"
                        onMouseDown={() => {
                          // Index rows carry only what the dropdown shows —
                          // the route effect loads the full player doc.
                          setPlayerSearch(""); setSearchOpen(false);
                          if (p.Slug && p.Slug !== loadedPlayer?.Slug) navigate(`/comparison/${p.Slug}`);
                        }}
                        style={{ padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "2px 10px" }}
                      >
                        <span style={{ fontWeight: 800, color: "#222", fontSize: "13px" }}>{p.First} {p.Last}</span>
                        <span style={{ fontWeight: 700, color: "#888", fontSize: "12px" }}>{p.Position} · {p.School} · {p.Eligible}</span>
                      </div>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
            </div>
          </div>
        </div>
        <div style={{ height: "4px", background: heroColor2 }} />
      </div>

      <div>

        {/* Page's keyword heading (seoHeading) — directly under the hero,
            above the measurement chips. The matching short description
            stays in the quiet section at the bottom of the column. */}
        {seoName && (
          <h2 style={{ fontSize: isMobile ? "14px" : "16px", fontWeight: 900, color: heroColor1, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center", margin: "0 0 14px" }}>
            {seoHeading}
            <InfoTip color={heroColor1} text={COMP_DISCLAIMER} />
          </h2>
        )}

        {/* ── Missing-traits prompt — traits are half of a full match (see
            findComps: 100% = same measurements + 3 shared strengths AND 3
            shared weaknesses), so a search with fewer than 3 strengths says
            so and offers the fix instead of quietly returning low-ceiling
            matches. Keyed on strengths only — weaknesses are thinner on
            most evaluations, and prompting on them too would show this on
            nearly every search. ── */}
        {submitted && submitted.traitWeight > 0 && submitted.strengths.length < TRAIT_MATCH_TARGET && (() => {
          const none = submitted.strengths.length + submitted.weaknesses.length === 0;
          const who = loadedPlayer ? `${loadedPlayer.First} ${loadedPlayer.Last}` : "This search";
          return (
            <div className="wd-comp-card" style={{ ...cardStyle, padding: "16px 20px", marginBottom: "18px", borderLeft: `5px solid ${GOLD}`, display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                <div style={{ fontSize: "14px", fontWeight: 900, color: "#222", marginBottom: "3px" }}>
                  {none
                    ? `${who} ${loadedPlayer ? "doesn't have" : "has no"} strengths or weaknesses yet`
                    : `Add more strengths for a full match`}
                </div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#777" }}>
                  {none
                    ? "These matches are on measurements alone. Add up to 5 strengths and 5 weaknesses — a full match takes 3 of each in common."
                    : `A full match takes 3 shared strengths — this search has ${submitted.strengths.length}.`}
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={() => { setCalcOpen(true); setTimeout(() => calcRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }}
                  className="wd-comp-cta"
                  style={{ background: GOLD, color: "#fff", border: "none", borderRadius: "999px", padding: "9px 16px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer" }}
                >
                  Add Traits
                </button>
                {loadedPlayer && (
                  <Link
                    to={`/player/${loadedPlayer.Slug}`}
                    style={{ border: `2px solid ${BLUE}`, color: BLUE, borderRadius: "999px", padding: "7px 14px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em", textDecoration: "none" }}
                  >
                    Evaluate {loadedPlayer.Last} →
                  </Link>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Results lead — the exciting part of the page comes first ── */}
        {/* A search on a position whose pool is still loading (e.g. the
            calculator switched to a new position) — spinner, not a false
            "no matches". */}
        {submitted && !resultsPool && <LoadingSpinner label="Loading" size={32} minHeight="120px" />}
        {submitted && resultsPool && (
          results.length === 0 ? (
            <div className="wd-comp-card" style={{ ...cardStyle, padding: "40px", textAlign: "center", color: "#999", fontWeight: 700, marginBottom: "20px" }}>
              No graded {submitted.position}s match yet — try widening the height window or clearing a measurement.
            </div>
          ) : (
            <div style={{ marginBottom: "24px" }}>
              {submittedMetrics.length > 0 && (
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center", marginBottom: "18px" }}>
                  {/* Hover (or tap) fills the chip with school Color1 and
                      swaps the value for the entry's percentile among
                      drafted players at the position — just "97%", in
                      white (always legible on Color1, whatever the school's
                      Color2 is) — with the label staying underneath so
                      it's clear which measurement it is. Same two lines
                      either way, so the chip never resizes. */}
                  {submittedMetrics.map((m) => {
                    const pct = percentileOf(submitted.values[m.key], percentileStats[submitted.position]?.metrics[m.key], m.lowerIsBetter);
                    const pctRounded = pct == null ? null : Math.min(99, Math.max(1, Math.round(pct)));
                    const active = activeChip === m.key && pctRounded != null;
                    return (
                      <div
                        key={m.key}
                        onPointerDown={(e) => { lastPointerType.current = e.pointerType; }}
                        onPointerEnter={(e) => { if (e.pointerType === "mouse") setActiveChip(m.key); }}
                        onPointerLeave={(e) => { if (e.pointerType === "mouse") setActiveChip((c) => (c === m.key ? null : c)); }}
                        onClick={() => { if (lastPointerType.current !== "mouse") setActiveChip((c) => (c === m.key ? null : m.key)); }}
                        title={pctRounded == null ? undefined : `${ordinal(pctRounded)} percentile among drafted ${submitted.position}s`}
                        style={{
                          minWidth: "96px", boxSizing: "border-box", borderRadius: "12px", padding: "10px 18px", textAlign: "center", cursor: "default",
                          background: active ? heroColor1 : "#fff",
                          border: `2px solid ${active ? heroColor1 : "#e4e9f0"}`,
                          transition: "background 0.2s ease, border-color 0.2s ease",
                        }}
                      >
                        {/* Value and percentile both rendered in one grid
                            cell, only visibility toggled — the chip is always
                            as wide as the wider of the two, so hovering never
                            resizes it (swapping the text did). */}
                        <div style={{ display: "grid", fontSize: "19px", fontWeight: 900, lineHeight: 1.1 }}>
                          <span style={{ gridArea: "1 / 1", color: heroColor1, visibility: active ? "hidden" : "visible" }}>{formatStatValue(m, submitted.values[m.key])}</span>
                          {pctRounded != null && (
                            <span style={{ gridArea: "1 / 1", color: "#fff", visibility: active ? "visible" : "hidden" }} aria-hidden={!active}>{pctRounded}%</span>
                          )}
                        </div>
                        <div style={{ fontSize: "10px", fontWeight: 900, marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", color: active ? "rgba(255,255,255,0.8)" : "#999", transition: "color 0.2s ease" }}>
                          {m.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                {/* Top 3 — two faces stacked in one grid cell (so the card
                    is always as tall as the taller face and never jumps):
                    the resting face is player info only; hover (or tap)
                    floods the card with the comp's NFL team color and swaps
                    in their measurements + Strengths/Weaknesses, with the
                    traits they share with the entry highlighted. */}
                {top3.map((r, i) => {
                  const abbr = resolveNflAbbr(r.record["NFL Team"]);
                  const team = abbr ? nflBranding[abbr] : null;
                  // We-Draft.com Select (see selectRecord): hand-picked, so
                  // it carries no match % — the WD mark stands in for the
                  // wheel, and the card gets a gold frame, glow and ribbon.
                  const isSelect = !!r.select;
                  const tier = isSelect ? { color: GOLD } : matchTier(r.similarity);
                  const fill = team?.Color1 || NAVY;
                  // Resting stroke + wheel: team color, falling back to the
                  // match tier's color until/unless the team doc resolves.
                  const accent = team?.Color1 || tier.color;
                  // Name text on the white resting face — team color, except
                  // a light Color1 (e.g. a yellow) swaps to Color2 so the
                  // name stays readable on white.
                  const nameColor = isLightColor(accent) && team?.Color2 ? team.Color2 : accent;
                  const onFill = isLightColor(fill) ? "#111" : "#fff";
                  const onFillMuted = isLightColor(fill) ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.75)";
                  const active = activeCard === i;
                  // Light-background wordmark for the white resting face.
                  // Most nfl/{abbr} docs don't have one uploaded yet — those
                  // fall back to the team nickname set in the team color, so
                  // the card's footer is never empty.
                  const restWordmark = team?.Wordmark || "";
                  const wordmarkText = (team?.Team || displayTeamName(r.record["NFL Team"]) || "").toUpperCase();
                  const fillLogo = team ? (team.LogoDark || team.Logo1 || "") : "";
                  const draftLine = `${r.record.Year} · Round ${parseInt(r.record.Round, 10)}${r.record.Pick ? `, Pick ${r.record.Pick}` : ""}`;
                  const measured = STAT_METRICS.filter((m) => r.values[m.key] != null);
                  const shared = new Set([...(r.traits?.sharedStrengths || []), ...(r.traits?.sharedWeaknesses || [])]);
                  const faceStyle = { gridArea: "1 / 1", padding: "22px 20px", transition: "opacity 0.2s ease", display: "flex", flexDirection: "column" };
                  // Comps from the latest drafted class still have a live
                  // player page (their row carries its Slug); older
                  // historical comps don't, so those cards stay non-links.
                  // Mouse: hover flips as before, a click opens the page.
                  // Touch: first tap flips (as before); the flipped side
                  // shows a "View Prospect Page" link to tap through.
                  const profileSlug = r.record.Slug || "";
                  return (
                    <div
                      key={r.record.id || i}
                      className={isSelect ? "wd-comp-card wd-select-card" : "wd-comp-card"}
                      title={isSelect ? "We-Draft.com Select — hand-picked by our analysts" : undefined}
                      onPointerDown={(e) => { lastPointerType.current = e.pointerType; }}
                      onPointerEnter={(e) => { if (e.pointerType === "mouse") setActiveCard(i); }}
                      onPointerLeave={(e) => { if (e.pointerType === "mouse") setActiveCard((a) => (a === i ? null : a)); }}
                      onClick={() => {
                        if (lastPointerType.current !== "mouse") setActiveCard((a) => (a === i ? null : i));
                        else if (profileSlug) navigate(`/player/${profileSlug}`);
                      }}
                      onKeyDown={(e) => { if (profileSlug && e.key === "Enter") navigate(`/player/${profileSlug}`); }}
                      role={profileSlug ? "link" : undefined}
                      tabIndex={profileSlug ? 0 : undefined}
                      aria-label={profileSlug ? `${recordName(r.record)} prospect page` : undefined}
                      style={{
                        ...cardStyle, display: "grid", textAlign: "center", cursor: profileSlug ? "pointer" : "default",
                        animationDelay: `${i * 0.08}s`,
                        background: active ? fill : "#fff",
                        border: isSelect ? `3px solid ${GOLD}` : `2px solid ${active ? fill : accent}`,
                        transition: "background 0.25s ease, border-color 0.25s ease",
                        position: "relative",
                      }}
                    >
                      {isSelect && (
                        <div style={{
                          position: "absolute", top: 0, left: 0, right: 0, height: "19px", zIndex: 2, overflow: "hidden",
                          background: `linear-gradient(90deg, ${NAVY}, ${BLUE}, ${NAVY})`, borderBottom: `2px solid ${GOLD}`,
                          display: "flex", alignItems: "center", justifyContent: "center", gap: "7px", pointerEvents: "none",
                        }}>
                          <img src={WdWordmark} alt="We-Draft.com" style={{ height: "10px", width: "auto", filter: "brightness(0) invert(1)" }} />
                          <span style={{ color: GOLD, fontSize: "9px", fontWeight: 900, letterSpacing: "0.16em" }}>SELECT</span>
                          <span className="wd-select-shine" style={{
                            position: "absolute", top: 0, bottom: 0, left: 0, width: "40%",
                            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
                            animation: "wdSelectShine 3.6s ease-in-out infinite",
                          }} />
                        </div>
                      )}
                      {/* Resting face — name leads (big, top of the card),
                          then the match wheel, draft line, and the NFL
                          team's wordmark pinned to the bottom. */}
                      <div style={{ ...faceStyle, opacity: active ? 0 : 1, pointerEvents: active ? "none" : "auto" }} aria-hidden={active}>
                        {/* First / last always stacked, like the hero's name. */}
                        <div style={{ fontSize: "clamp(24px, 2.6vw, 30px)", fontWeight: 900, color: nameColor, lineHeight: 1.02, textTransform: "uppercase", letterSpacing: "0.01em", marginBottom: "6px" }}>
                          {recordNameParts(r.record).filter(Boolean).map((part, pi) => <div key={pi}>{part}</div>)}
                        </div>
                        <div style={{ fontSize: "15px", fontWeight: 800, color: "#777", marginBottom: "16px" }}>{r.record.Position} · {r.record.School}</div>
                        {isSelect ? (
                          <div style={{ position: "relative", width: "124px", height: "124px", margin: "0 auto 16px" }}>
                            <div className="wd-select-ring" style={{
                              position: "absolute", inset: 0, borderRadius: "50%",
                              background: `conic-gradient(${GOLD}, #ffe39a, ${GOLD}, ${NAVY}, ${GOLD})`,
                              animation: "wdSelectSpin 7s linear infinite",
                            }} />
                            <div style={{ position: "absolute", inset: "12px", borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <img src="/wd-icon-512.png" alt="We-Draft.com Select" style={{ width: "88px", height: "88px", objectFit: "contain" }} />
                            </div>
                          </div>
                        ) : (
                          <div style={{
                            width: "124px", height: "124px", borderRadius: "50%", margin: "0 auto 16px",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: `conic-gradient(${accent} ${r.similarity * 3.6}deg, #eef1f6 0deg)`,
                          }}>
                            <div style={{ width: "100px", height: "100px", borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <div style={{ fontSize: "28px", fontWeight: 900, color: accent, letterSpacing: "-0.01em" }}>{r.similarity.toFixed(0)}%</div>
                            </div>
                          </div>
                        )}
                        {/* Draft year on its own line, round/pick underneath. */}
                        <div style={{ marginBottom: "14px", color: BLUE, lineHeight: 1.1 }}>
                          <div style={{ fontSize: "24px", fontWeight: 900, letterSpacing: "0.02em" }}>{r.record.Year}</div>
                          <div style={{ fontSize: "14px", fontWeight: 800, marginTop: "2px" }}>
                            Round {parseInt(r.record.Round, 10)}{r.record.Pick ? ` · Pick ${r.record.Pick}` : ""}
                          </div>
                        </div>
                        {/* Wordmark — sized by width, not height: it
                            bleeds 12px into the card's side padding (8px
                            short of the border) and takes whatever height
                            that width gives it, up to WORDMARK_BAND. It sits
                            centered in a fixed WORDMARK_BAND-tall band pinned
                            to the card's bottom — the three cards stretch to
                            the same height in their grid row, so every
                            band lines up and every mark's vertical center
                            lands on the same line, however tall or wide the
                            individual mark is. The text fallback is an SVG
                            sized the same way, with textLength so any
                            nickname runs edge to edge. */}
                        <div style={{ marginTop: "auto", marginLeft: "-12px", marginRight: "-12px", width: "calc(100% + 24px)", height: WORDMARK_BAND, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {restWordmark ? (
                            <TrimmedImg
                              src={sanitizeUrl(restWordmark)} alt={displayTeamName(r.record["NFL Team"])}
                              style={{ display: "block", width: "100%", height: "auto", maxHeight: WORDMARK_BAND, objectFit: "contain" }}
                            />
                          ) : wordmarkText && (
                            // Canvas width follows the name's length (~25
                            // units/char at this font size), so textLength
                            // only nudges it to fit instead of visibly
                            // stretching short names like "JETS" — those
                            // just come out taller (up to WORDMARK_BAND).
                            <svg viewBox={`0 0 ${Math.max(60, wordmarkText.length * 25)} 40`} width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label={wordmarkText} style={{ display: "block", maxHeight: WORDMARK_BAND }}>
                              <text
                                x={Math.max(60, wordmarkText.length * 25) / 2} y="31" textAnchor="middle"
                                textLength={Math.max(60, wordmarkText.length * 25) - 4} lengthAdjust="spacingAndGlyphs"
                                fill={nameColor} fontSize="36" fontWeight="900" fontStyle="italic" fontFamily="inherit"
                              >
                                {wordmarkText}
                              </text>
                            </svg>
                          )}
                        </div>
                      </div>

                      {/* Detail face — team color fill, measurements, traits */}
                      <div style={{ ...faceStyle, opacity: active ? 1 : 0, pointerEvents: active ? "auto" : "none", color: onFill }} aria-hidden={!active}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", textAlign: "left" }}>
                          {fillLogo && (
                            <img
                              src={sanitizeUrl(fillLogo)} alt=""
                              style={{ height: "32px", width: "auto", maxWidth: "56px", objectFit: "contain", flexShrink: 0 }}
                              onError={(e) => { e.currentTarget.style.display = "none"; }}
                            />
                          )}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: "17px", fontWeight: 900, lineHeight: 1.15 }}>{recordName(r.record)}</div>
                            <div style={{ fontSize: "11px", fontWeight: 700, color: onFillMuted }}>{draftLine}</div>
                          </div>
                          {isSelect ? (
                            <img src="/wd-icon-512.png" alt="We-Draft.com Select" style={{ width: "34px", height: "34px", flexShrink: 0 }} />
                          ) : (
                            <div style={{ fontSize: "16px", fontWeight: 900, flexShrink: 0 }}>{r.similarity.toFixed(0)}%</div>
                          )}
                        </div>

                        {measured.length > 0 && (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px 6px", marginBottom: "12px", paddingBottom: "12px", borderBottom: `1px solid ${onFillMuted}` }}>
                            {measured.map((m) => (
                              <div key={m.key}>
                                <div style={{ fontSize: "14px", fontWeight: 900 }}>{formatStatValue(m, r.values[m.key])}</div>
                                <div style={{ fontSize: "9px", fontWeight: 800, color: onFillMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{m.label}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {r.traits && [
                          { label: "Strengths", list: r.traits.strengths },
                          { label: "Weaknesses", list: r.traits.weaknesses },
                        ].filter(({ list }) => list.length > 0).map(({ label, list }) => (
                          <div key={label} style={{ textAlign: "left", marginBottom: "8px" }}>
                            <div style={{ fontSize: "9px", fontWeight: 900, color: onFillMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>{label}</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                              {list.map((t) => (
                                <span
                                  key={t}
                                  title={shared.has(t) ? "Shared with this prospect" : undefined}
                                  style={{
                                    fontSize: "11px", fontWeight: 800, padding: "3px 8px", borderRadius: "999px",
                                    border: `1.5px solid ${onFillMuted}`,
                                    background: shared.has(t) ? onFill : "transparent",
                                    color: shared.has(t) ? fill : onFill,
                                  }}
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}

                        {profileSlug && (
                          <Link
                            to={`/player/${profileSlug}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              marginTop: "auto", alignSelf: "center", paddingTop: "6px",
                              color: onFill, fontSize: "11px", fontWeight: 900, textTransform: "uppercase",
                              letterSpacing: "0.06em", textDecoration: "none", borderBottom: `1.5px solid ${onFillMuted}`,
                            }}
                          >
                            View Prospect Page →
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── More Matches (4-10) — same design language as the top-3
                  cards rather than a data table: each comp is its own row
                  in their NFL team's colors — team logo, big bold name in
                  Color1 (Color2 if Color1 is too light for white), school
                  and draft line underneath, and a slim team-color match bar
                  echoing the top-3 wheels. Hover tints the row with the
                  team color. 2026 comps (they have a player page) link
                  through; older ones are plain rows. ── */}
              {rest.length > 0 && (
                <div className="wd-comp-card" style={{ ...cardStyle, padding: isMobile ? "14px 12px 6px" : "18px 20px 8px" }}>
                  <h3 style={{ ...sectionStyle, margin: "0 0 6px", fontSize: "12px" }}>More Matches</h3>
                  <div>
                    {rest.map((r, i) => {
                      const tier = matchTier(r.similarity);
                      const abbr = resolveNflAbbr(r.record["NFL Team"]);
                      const team = abbr ? nflBranding[abbr] : null;
                      const rowLogo = team ? (team.Logo1 || team.LogoDark || "") : "";
                      const accent = team?.Color1 || tier.color;
                      const nameColor = isLightColor(accent) && team?.Color2 ? team.Color2 : accent;
                      const pct = Math.round(r.similarity);
                      const round = parseInt(r.record.Round, 10);
                      const rowInner = (
                        <>
                          <div style={{ width: "22px", flexShrink: 0, fontSize: "13px", fontWeight: 900, color: "#b7bfcc", textAlign: "center" }}>{i + 4}</div>
                          {/* Fixed-size slot so names stay aligned even
                              before a logo loads / when a team has none. */}
                          <div style={{ width: isMobile ? "36px" : "44px", height: isMobile ? "36px" : "44px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {rowLogo && (
                              <img
                                src={sanitizeUrl(rowLogo)} alt={displayTeamName(r.record["NFL Team"])} title={displayTeamName(r.record["NFL Team"])}
                                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                                onError={(e) => { e.currentTarget.style.display = "none"; }}
                              />
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: isMobile ? "15px" : "18px", fontWeight: 900, color: nameColor, textTransform: "uppercase", letterSpacing: "0.01em", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {recordName(r.record)}
                            </div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: "#8a94a6", marginTop: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {r.record.School} · {r.record.Year} · Round {round}{r.record.Pick ? `, Pick ${r.record.Pick}` : ""}
                            </div>
                          </div>
                          <div style={{ width: isMobile ? "64px" : "120px", flexShrink: 0, textAlign: "right" }}>
                            <div style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 900, color: accent, lineHeight: 1 }}>{pct}%</div>
                            <div style={{ height: "5px", borderRadius: "999px", background: "#eef1f6", marginTop: "6px", overflow: "hidden" }}>
                              <div style={{ width: `${pct}%`, height: "100%", borderRadius: "999px", background: accent }} />
                            </div>
                          </div>
                        </>
                      );
                      const rowStyle = {
                        display: "flex", alignItems: "center", gap: isMobile ? "10px" : "14px",
                        padding: isMobile ? "10px 6px" : "12px 10px", borderRadius: "12px", textDecoration: "none",
                        borderTop: i === 0 ? "none" : "1px solid #f0f2f6",
                        "--wd-row-tint": `${accent}14`,
                      };
                      return r.record.Slug ? (
                        <Link key={r.record.id || i} to={`/player/${r.record.Slug}`} className="wd-comp-more-row" style={rowStyle}>{rowInner}</Link>
                      ) : (
                        <div key={r.record.id || i} className="wd-comp-more-row" style={rowStyle}>{rowInner}</div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {/* ── Calculator — collapses to a one-line summary once a search has
            run, so the inputs don't compete with the results for space ── */}
        <div ref={calcRef} className="wd-comp-card" style={{ ...cardStyle, padding: calcOpen ? "22px" : "14px 20px", marginBottom: "24px" }}>
          <div
            className="wd-comp-toggle"
            onClick={() => setCalcOpen((o) => !o)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", gap: "12px", flexWrap: "wrap" }}
          >
            {calcOpen ? (
              <div style={sectionStyle}>⚙ Customize Inputs</div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ background: GOLD, color: "#fff", fontWeight: 900, fontSize: "11px", padding: "4px 10px", borderRadius: "999px" }}>{position}</span>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#666" }}>
                  {filledCount} measurement{filledCount === 1 ? "" : "s"} · {strengths.length} strength{strengths.length === 1 ? "" : "s"} · {weaknesses.length} weakness{weaknesses.length === 1 ? "" : "es"}
                  {classMode === "recommended" ? " · We-Draft Recommended" : effectiveFromYear && ` · ${effectiveFromYear}–${effectiveToYear}`}
                </span>
              </div>
            )}
            <span style={{ fontSize: "11px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {calcOpen ? "▲ Collapse" : "✎ Edit Inputs"}
            </span>
          </div>

          {calcOpen && (
            <div className="wd-comp-form">
              <div style={{ ...sectionStyle, marginTop: "20px" }}>Position</div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "20px" }}>
                {POSITION_ORDER.map((p) => (
                  <button
                    key={p}
                    onClick={() => changePosition(p)}
                    className="wd-comp-chip"
                    style={{
                      padding: "7px 16px", fontWeight: 900, fontSize: "12px", borderRadius: "999px", cursor: "pointer",
                      border: `2px solid ${position === p ? GOLD : "#e4e9f0"}`,
                      background: position === p ? GOLD : "#fff", color: position === p ? "#fff" : "#555",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "22px", marginBottom: "20px" }}>
                <div>
                  <div style={sectionStyle}>Physical</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>{COMP_PHYSICAL_KEYS.map(renderMetric)}</div>
                </div>
                <div>
                  <div style={sectionStyle}>Athletic</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>{COMP_ATHLETIC_KEYS.map(renderMetric)}</div>
                </div>
              </div>

              {/* Draft Classes — right under the measurements. We-Draft
                  Recommended by default (see recommendedCompWindow);
                  Custom opens a From/To range over the graded classes
                  (see gradedClassYears/defaultFromYear). */}
              <div style={sectionStyle}>Draft Classes</div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
                <select value={classMode} onChange={(e) => setClassMode(e.target.value)} style={{ ...inputStyle, width: "210px" }}>
                  <option value="recommended">We-Draft Recommended</option>
                  <option value="custom">Custom range</option>
                </select>
                {classMode === "custom" ? (
                  <>
                    <select value={effectiveFromYear} onChange={(e) => setFromYear(e.target.value)} style={{ ...inputStyle, width: "110px" }}>
                      {years.filter((y) => !effectiveToYear || y <= effectiveToYear).map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <span style={{ color: "#bbb", fontWeight: 900 }}>—</span>
                    <select value={effectiveToYear} onChange={(e) => setToYear(e.target.value)} style={{ ...inputStyle, width: "110px" }}>
                      {years.filter((y) => !effectiveFromYear || y >= effectiveFromYear).map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </>
                ) : recWindow && (
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#999" }}>
                    {recWindow.coreFrom}–{recWindow.to}, plus select players from {recWindow.extFrom}–{recWindow.coreFrom - 1}
                    {loadedPlayer && doubleExtendedFor(subjectRound) && ` and select all-time greats from before ${recWindow.extFrom}`}
                  </span>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "22px", marginBottom: "10px" }}>
                {[{ kind: "Strengths", sel: strengths, color: "#2e7d32" }, { kind: "Weaknesses", sel: weaknesses, color: "#c0392b" }].map(({ kind, sel, color }) => {
                  const other = kind === "Strengths" ? weaknesses : strengths;
                  return (
                    <div key={kind}>
                      <div style={sectionStyle}>{kind} <span style={{ color: "#bbb", fontWeight: 700 }}>(up to 5)</span></div>
                      {/* One chip group per trait source, each under its own
                          small header (Position Specific / Generic). */}
                      {Object.values(traitGroups).flat().length === 0 ? (
                        <div style={{ fontSize: "12px", color: "#999", fontStyle: "italic" }}>No traits defined for {position}.</div>
                      ) : Object.entries(traitGroups).filter(([, opts]) => opts.length > 0).map(([groupLabel, opts]) => (
                        <div key={groupLabel} style={{ marginBottom: "12px" }}>
                          <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>{groupLabel}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {opts.map((trait) => {
                              const isOther = other.includes(trait);
                              const isSel = sel.includes(trait);
                              return (
                                <button
                                  key={trait}
                                  className="wd-comp-chip"
                                  disabled={isOther || (!isSel && sel.length >= 5)}
                                  onClick={() => toggleTrait(trait, kind)}
                                  style={{
                                    padding: "6px 12px", borderRadius: "999px", fontSize: "12px", fontWeight: 800,
                                    border: `2px solid ${isSel ? color : "#e4e9f0"}`,
                                    background: isSel ? color : "#fff",
                                    color: isSel ? "#fff" : isOther ? "#ccc" : "#555",
                                    cursor: isOther ? "not-allowed" : "pointer",
                                  }}
                                >
                                  {trait}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              <details style={{ marginTop: "16px" }}>
                <summary style={{ cursor: "pointer", fontSize: "11px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em" }}>Fine-tune matching</summary>
                <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginTop: "10px" }}>
                  <div>
                    <div style={{ ...labelStyle, marginBottom: "3px" }}>Height window</div>
                    <select value={heightWindow} onChange={(e) => setHeightWindow(e.target.value)} style={{ ...inputStyle, width: "140px" }}>
                      {HEIGHT_WINDOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ ...labelStyle, marginBottom: "3px" }}>Trait weight</div>
                    <select value={traitWeight} onChange={(e) => setTraitWeight(e.target.value)} style={{ ...inputStyle, width: "140px" }}>
                      {TRAIT_WEIGHT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              </details>

              <div style={{ display: "flex", gap: "10px", marginTop: "22px" }}>
                <button
                  onClick={runSearch}
                  disabled={!canSearch}
                  className="wd-comp-cta"
                  style={{
                    flex: 1, background: canSearch ? GOLD : "#ddd", color: "#fff", border: "none", borderRadius: "999px",
                    padding: "14px", fontWeight: 900, fontSize: "14px", textTransform: "uppercase", letterSpacing: "0.06em",
                    cursor: canSearch ? "pointer" : "not-allowed", boxShadow: canSearch ? "0 6px 18px rgba(246,162,29,0.35)" : "none",
                  }}
                >
                  Compare
                </button>
              </div>
              {loadStatus && <div style={{ fontSize: "12px", fontWeight: 700, color: "#888", marginTop: "8px" }}>{loadStatus}</div>}
            </div>
          )}
        </div>

        {/* SEO description — visible (not hidden: text that's in the markup
            but hidden from visitors is treated as spam by search engines and
            earns nothing anyway), but parked at the bottom of the main
            column in a quiet style so it doesn't disrupt the page's design.
            Its heading (seoHeading) sits under the hero instead. */}
        {seoName && (
          <section style={{ padding: "4px 6px 8px" }}>
            <p style={{ fontSize: "12px", fontWeight: 600, color: "#98a1b3", lineHeight: 1.6, margin: 0 }}>
              See how {seoName} compares to past NFL Draft picks using physical measurements, athletic testing, and playing traits.
              The players above have the most similar profiles based on We-Draft&apos;s comparison model and historical draft data.
            </p>
          </section>
        )}
      </div>
      </div>
      {/* Right column — Playing now (while his team is live), Videos + In
          The News for the loaded prospect,
          same as PlayerProfile.js's right column (sticky on desktop,
          stacked under the main content on mobile). Empty column on
          desktop when nobody's loaded, so the center never shifts. */}
      {isStacked ? (
        loadedPlayer && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <PlayerVideosCard videos={sidebarVideos} accentColor={heroColor1} />
            <PlayerNewsCard news={sidebarNews} />
          </div>
        )
      ) : (
        <div style={{ position: "sticky", top: "20px", display: "flex", flexDirection: "column", gap: "18px" }}>
          {loadedPlayer && (
            <>
              <PlayerLiveCard player={loadedPlayer} />
              <PlayerVideosCard videos={sidebarVideos} accentColor={heroColor1} />
              <PlayerNewsCard news={sidebarNews} />
            </>
          )}
        </div>
      )}
      </div>
      {/* Ads lead with the loaded prospect's college's NFL affiliate
          (schools/{School}.NFL — same affiliate PlayerProfile.js's own ads
          prioritize for an undrafted prospect); random otherwise. */}
      <MarginAds contentRef={mainGridRef} isMobile={isStacked} horizontalPadding={60} preferTeam={drafted?.team || schoolBranding?.NFL || ""} />
    </div>
  );
}
