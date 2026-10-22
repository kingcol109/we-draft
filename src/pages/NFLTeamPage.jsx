import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useEffect, useRef, useMemo } from "react";
import {
  doc, getDoc, collection, query, where, getDocs, orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import Logo1 from "../assets/Logo1.png";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import MarginAds from "../components/MarginAds";
import { useMobileStuckPageWatchdog } from "../hooks/useMobileStuckPageWatchdog";
import DraftArchiveList, { ArchiveFilterButton, useSchoolLogos } from "../components/DraftArchiveList";
import { ROLE_BY_KEY, isOpenStint, stintYearSpan, groupStints } from "../utils/coachHistory";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// ── Community grade scale — same shape CommunityBoard.js/PlayerProfile.js
// each keep their own copy of, used by the "+" tile's board popup below to
// rank 2027 prospects the same way the real Community Board does. ──
const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
  "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
  "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, UDFA: 10,
};
const gradeLabels = {
  1: "Early First Round", 2: "Middle First Round", 3: "Late First Round",
  4: "Second Round", 5: "Third Round", 6: "Fourth Round",
  7: "Fifth Round", 8: "Sixth Round", 9: "Seventh Round", 10: "UDFA",
};
// Round buckets for the board popup's Grade filter — Early/Middle/Late
// First Round all fold into one "First Round" option (same collapse
// gradeDisplay's own `short` badge already does — all three read as "1st"
// there too), so picking First Round and Second Round shows every player
// in either, instead of needing all three First Round sub-tiers checked
// individually to mean the same thing.
const ROUND_BUCKET = {
  "Early First Round": "First Round", "Middle First Round": "First Round", "Late First Round": "First Round",
};
const roundOrder = [
  "Watchlist", "First Round", "Second Round", "Third Round", "Fourth Round",
  "Fifth Round", "Sixth Round", "Seventh Round", "UDFA",
];
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
  return map[g] || map["Watchlist"];
};

// ESPN team ID map (abbreviation → ESPN numeric ID)
const ESPN_TEAM_IDS = {
  ARI: 22, ATL: 1,  BAL: 33, BUF: 2,  CAR: 29, CHI: 3,  CIN: 4,  CLE: 5,
  DAL: 6,  DEN: 7,  DET: 8,  GB: 9,   HOU: 34, IND: 11, JAX: 30, KC: 12,
  LV: 13,  LAC: 24, LAR: 14, MIA: 15, MIN: 16, NE: 17,  NO: 18,  NYG: 19,
  NYJ: 20, PHI: 21, PIT: 23, SF: 25,  SEA: 26, TB: 27,  TEN: 10, WAS: 28,
};

// Position groups — covers all known ESPN abbreviation variants
const POSITION_GROUPS = {
  "Quarterbacks":     ["QB"],
  "Running Backs":    ["RB", "FB", "HB"],
  "Wide Receivers":   ["WR"],
  "Tight Ends":       ["TE"],
  "Offensive Line":   ["OL", "OT", "OG", "C", "CTR", "OC", "LT", "RT", "LG", "RG", "G", "T"],
  "Defensive Line":   ["DL", "DE", "DT", "NT", "DE/DT"],
  "Edge Rushers":     ["EDGE", "OLB/DE", "DE/OLB"],
  "Linebackers":      ["LB", "ILB", "OLB", "MLB", "SLB", "WLB"],
  "Cornerbacks":      ["CB", "RCB", "LCB", "NCB"],
  "Safeties":         ["S", "FS", "SS", "SAF"],
  "Defensive Backs":  ["DB"],
  "Specialists":      ["K", "P", "PK", "LS", "KR", "PR"],
};

// Roster position group → We-Draft Community Board position(s) — drives
// the "+" tile at the end of each group below (links to that position's
// 2027 board). Cornerbacks and Safeties both fold into the board's single
// "DB" bucket, since the college side never splits them the way an NFL
// roster does; Defensive Line and Edge Rushers both link to a combined
// DL+EDGE view (via a comma-joined URL segment — see CommunityBoard.js's
// own positionParams/selectedPositions handling), since the two groups'
// prospect pools genuinely overlap. Specialists has no board equivalent
// at all, so it's left out on purpose — no "+" tile renders for it.
const ROSTER_GROUP_TO_BOARD_POSITIONS = {
  "Quarterbacks": ["QB"],
  "Running Backs": ["RB"],
  "Wide Receivers": ["WR"],
  "Tight Ends": ["TE"],
  "Offensive Line": ["OL"],
  "Defensive Line": ["DL", "EDGE"],
  "Edge Rushers": ["DL", "EDGE"],
  "Linebackers": ["LB"],
  "Cornerbacks": ["DB"],
  "Safeties": ["DB"],
  "Defensive Backs": ["DB"],
};

// ── Season stats for the player card — ESPN's per-athlete season totals
// (regular season), fetched on hover/tap. The season rolls over in
// September; before a player has a line for it (week 1 not played, or
// he hasn't appeared yet) the card falls back to the previous season. ──
const currentSeason = () => {
  const d = new Date();
  return d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
};
const OL_POSITIONS = ["OL", "OT", "OG", "C", "CTR", "OC", "LT", "RT", "LG", "RG", "G", "T"];

// ESPN categories → { category: { statName: value } }, names lowercased.
function indexStats(categories) {
  const out = {};
  (categories || []).forEach((c) => {
    const bucket = (out[String(c.name || "").toLowerCase()] = {});
    (c.stats || []).forEach((st) => { if (st.value != null) bucket[st.name] = Number(st.value); });
  });
  return out;
}

const fmtStat = (v, decimals = 0) => (v == null || Number.isNaN(v) ? null : decimals ? v.toFixed(decimals) : String(Math.round(v)));
const ratio = (a, b) => (a == null || b == null ? null : `${Math.round(a)}/${Math.round(b)}`);

// The handful of numbers that matter for a player's position, as
// [{ label, value }] — empties dropped. Games played always leads.
function statLine(pos, s) {
  const g = (cat, name) => s[cat]?.[name];
  const p = String(pos || "").toUpperCase();
  let rows;
  if (p === "QB") rows = [
    ["CMP/ATT", ratio(g("passing", "completions"), g("passing", "passingAttempts"))],
    ["YDS", fmtStat(g("passing", "passingYards"))],
    ["TD", fmtStat(g("passing", "passingTouchdowns"))],
    ["INT", fmtStat(g("passing", "interceptions"))],
    ["RTG", fmtStat(g("passing", "QBRating"), 1)],
  ];
  else if (["RB", "FB", "HB"].includes(p)) rows = [
    ["CAR", fmtStat(g("rushing", "rushingAttempts"))],
    ["YDS", fmtStat(g("rushing", "rushingYards"))],
    ["AVG", fmtStat(g("rushing", "yardsPerRushAttempt"), 1)],
    ["REC", fmtStat(g("receiving", "receptions"))],
    ["TD", fmtStat((g("rushing", "rushingTouchdowns") || 0) + (g("receiving", "receivingTouchdowns") || 0))],
  ];
  else if (["WR", "TE"].includes(p)) rows = [
    ["TGT", fmtStat(g("receiving", "receivingTargets"))],
    ["REC", fmtStat(g("receiving", "receptions"))],
    ["YDS", fmtStat(g("receiving", "receivingYards"))],
    ["AVG", fmtStat(g("receiving", "yardsPerReception"), 1)],
    ["TD", fmtStat(g("receiving", "receivingTouchdowns"))],
  ];
  else if (["K", "PK"].includes(p)) rows = [
    ["FG", ratio(g("kicking", "fieldGoalsMade"), g("kicking", "fieldGoalAttempts"))],
    ["FG%", fmtStat(g("kicking", "fieldGoalPct"), 1)],
    ["LNG", fmtStat(g("kicking", "longFieldGoalMade"))],
    ["XP", ratio(g("kicking", "extraPointsMade"), g("kicking", "extraPointAttempts"))],
    ["PTS", fmtStat(g("scoring", "totalPoints"))],
  ];
  else if (p === "P") rows = [
    ["PUNTS", fmtStat(g("punting", "punts"))],
    ["AVG", fmtStat(g("punting", "grossAvgPuntYards"), 1)],
    ["NET", fmtStat(g("punting", "netAvgPuntYards"), 1)],
    ["IN 20", fmtStat(g("punting", "puntsInside20"))],
    ["LNG", fmtStat(g("punting", "longPunt"))],
  ];
  else if (OL_POSITIONS.includes(p) || p === "LS") rows = [];
  else rows = [
    ["TKL", fmtStat(g("defensive", "totalTackles"))],
    ["TFL", fmtStat(g("defensive", "tacklesForLoss"), g("defensive", "tacklesForLoss") % 1 ? 1 : 0)],
    ["SACK", fmtStat(g("defensive", "sacks"), g("defensive", "sacks") % 1 ? 1 : 0)],
    ["INT", fmtStat(g("defensiveinterceptions", "interceptions"))],
    ["PD", fmtStat(g("defensive", "passesDefended"))],
  ];
  return [["GP", fmtStat(g("general", "gamesPlayed"))], ...rows]
    .filter(([, v]) => v != null)
    .map(([label, value]) => ({ label, value }));
}

// Roster status — ESPN's roster comes in groups (offense/defense/
// specialTeam, injuredReserveOrOut, suspended, practiceSquad), and active
// players can carry an injury designation. statusTag turns that into the
// chip's tag: { short, label, tone } or null for a healthy active player.
const ROSTER_GROUP_STATUS = { injuredReserveOrOut: "reserve", suspended: "suspended", practiceSquad: "ps" };
const STATUS_TIER = { active: 0, reserve: 1, suspended: 1, ps: 2 };
const STATUS_TONES = {
  out: { bg: "#c0392b", fg: "#fff" },
  warn: { bg: "#e0a100", fg: "#fff" },
  ps: { bg: "#fff", fg: "#5f6b7a", border: "#b8c1cc" },
};
function statusTag(player) {
  const inj = player.injury || "";
  if (player.rosterStatus === "ps") return { short: "PS", label: "Practice Squad", tone: "ps" };
  if (player.rosterStatus === "suspended") return { short: "SUSP", label: "Suspended", tone: "out" };
  if (player.rosterStatus === "reserve") {
    if (/injured reserve/i.test(inj)) return { short: "IR", label: "Injured Reserve", tone: "out" };
    if (/physically unable|pup/i.test(inj)) return { short: "PUP", label: "Physically Unable to Perform", tone: "out" };
    return { short: "OUT", label: inj || "Reserve / Out", tone: "out" };
  }
  if (!inj) return null;
  if (/^out$/i.test(inj)) return { short: "OUT", label: "Out", tone: "out" };
  if (/questionable/i.test(inj)) return { short: "Q", label: "Questionable", tone: "warn" };
  if (/doubtful/i.test(inj)) return { short: "D", label: "Doubtful", tone: "warn" };
  return { short: inj.slice(0, 3).toUpperCase(), label: inj, tone: "warn" };
}

// ESPN headshots are 350×254 PNGs — its image combiner serves a card-sized
// copy instead of the full-size download.
function headshotUrl(href, w) {
  const m = /^https?:\/\/a\.espncdn\.com(\/i\/headshots\/[^?]+)/.exec(href || "");
  return m ? `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${w}&h=${Math.round(w * 254 / 350)}&scale=crop&cquality=60` : href;
}

// Hero "energy" overlays — same drifting yard-line texture + breathing
// spotlight recipe as GamePage.js's matchup hero (and TeamPage.js's own
// copy of it), renamed per-page since this file doesn't import from
// either. Gives the hero some life instead of sitting as a flat card.
const HERO_STYLE = `
  @keyframes wdNflHeroDrift {
    0%   { transform: translate(0, 0); }
    100% { transform: translate(-80px, -46px); }
  }
  @keyframes wdNflHeroSpotlight {
    0%, 100% { opacity: 0.7; }
    50%      { opacity: 1; }
  }
  .wd-nfl-chip { transition: transform 0.16s ease, box-shadow 0.16s ease; }
  .wd-nfl-chip:hover { transform: translateY(-2px); }
  .wd-nfl-plus { transition: background 0.16s ease, transform 0.16s ease; }
  .wd-nfl-plus:hover { transform: translateY(-2px); }
  @media (prefers-reduced-motion: reduce) {
    .wd-nfl-chip, .wd-nfl-plus { transition: none !important; }
    .wd-nfl-chip:hover, .wd-nfl-plus:hover { transform: none; }
  }
`;

// Depth chart order — nflDepthOrder/{abbr} (scripts/nflTeamNeeds.js) is the
// team's player names by season snaps, most first. Names are matched to the
// ESPN roster loosely: punctuation and suffixes (Jr., III) dropped, then
// first initial + last name as a fallback ("Ken Walker" / "Kenneth Walker").
// Order only — snaps are never shown.
const depthNameKey = (name) => String(name || "").toLowerCase()
  .replace(/[^a-z\s-]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[\s-]+/g, " ").trim();
const initialKey = (name) => {
  const parts = depthNameKey(name).split(" ");
  return parts.length > 1 ? `${parts[0][0]} ${parts.slice(1).join(" ")}` : parts[0];
};
function depthRanker(order) {
  const full = new Map();
  const initial = new Map();
  (order || []).forEach((n, i) => {
    if (!full.has(depthNameKey(n))) full.set(depthNameKey(n), i);
    if (!initial.has(initialKey(n))) initial.set(initialKey(n), i);
  });
  return (p) => full.get(depthNameKey(p.fullName)) ?? initial.get(initialKey(p.fullName)) ?? Infinity;
}

// We-Draft profile links — roster players matched to players/{id} docs by
// name (same loose keys as the depth order), guarded by college when both
// sides have one so a same-named prospect never links to the wrong page.
// Only classes whose draft has already happened count (the draft is in late
// April), so every drafted class — and its undrafted signings — links
// automatically as it reaches the league.
const lastDraftYear = () => {
  const d = new Date();
  return d.getMonth() >= 4 ? d.getFullYear() : d.getFullYear() - 1;
};
const schoolKey = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const stripSuffix = (last) => String(last || "").replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, "").trim();

// Team colors are admin-entered hex — tint only when it's actually #rrggbb.
const tint = (hex, alpha) => (/^#[0-9a-f]{6}$/i.test(hex || "") ? `${hex}${alpha}` : "transparent");

// Section heading — title with a team-color rule fading out beside it
// (CFBPage.js's conference header look), optional count on the right.
function SectionTitle({ children, color1, color2, right, isMobile, sub = false }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: sub ? 10 : 14 }}>
      <div style={{
        fontWeight: 900, fontSize: sub ? (isMobile ? 13 : 14) : (isMobile ? 18 : 22), whiteSpace: "nowrap",
        textTransform: "uppercase", letterSpacing: sub ? "0.1em" : "0.08em", color: color1,
      }}>
        {children}
      </div>
      <div style={{ flex: 1, height: sub ? 2 : 3, borderRadius: 2, background: `linear-gradient(to right, ${color2}, ${tint(color2, "00")})` }} />
      {right != null && (
        <div style={{ fontSize: 11, fontWeight: 900, color: "#9aa5b4", whiteSpace: "nowrap" }}>{right}</div>
      )}
    </div>
  );
}

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

export default function NFLTeamPage() {
  const { teamId, tab: tabParam } = useParams();
  const navigate = useNavigate();
  const teamKey = teamId?.toUpperCase();

  const [team, setTeam] = useState(null);
  const [picks, setPicks] = useState([]);
  const [playersBySlug, setPlayersBySlug] = useState({});
  // Pre-2026 real draft history for this team — see the "historical"
  // collection AdminPanel.js's Player Data → Historical tab manages
  // (same source TeamPage.js's own college-side archive reads), filtered
  // here by "NFL Team" (a full "City Team" name string, not the
  // abbreviation this page's own teamKey is) instead of by School.
  const [historicalPicks, setHistoricalPicks] = useState([]);
  // "+" tile board popup — { positions, label } while open, null when
  // closed. Pops up in place instead of navigating away (see
  // ROSTER_GROUP_TO_BOARD_POSITIONS above for the group→position(s) map).
  const [boardModal, setBoardModal] = useState(null);
  const [boardModalPlayers, setBoardModalPlayers] = useState([]);
  const [boardModalLoading, setBoardModalLoading] = useState(false);
  // Board popup's own Grade/Strengths filters — same multi-select
  // checkbox shape as CommunityBoard.js's DropdownChecklist, just scoped
  // to this popup's own result set instead of the whole board.
  const [boardModalGradeFilter, setBoardModalGradeFilter] = useState(new Set());
  const [boardModalStrengthFilter, setBoardModalStrengthFilter] = useState(new Set());
  const [boardModalFilterPanel, setBoardModalFilterPanel] = useState(null);
  const [roster, setRoster] = useState([]);
  // nflDepthOrder/{abbr}.order — see depthRanker above.
  const [depthOrder, setDepthOrder] = useState(null);
  // ESPN athlete id → We-Draft player Slug (see lastDraftYear above).
  const [profileSlugs, setProfileSlugs] = useState({});
  // The page's content column — MarginAds centers its Homage rails in the
  // gutters beside it.
  const contentRef = useRef(null);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState(null);
  const [statsCache, setStatsCache] = useState({});
  const [statsLoading, setStatsLoading] = useState({});
  const [sheetPlayer, setSheetPlayer] = useState(null);
  // Page tab — /nfl/{team}/staff, /nfl/{team}/archive, the depth chart at
  // the bare /nfl/{team}.
  const tab = ["staff", "archive"].includes(tabParam) ? tabParam : "roster";
  const setTab = (t) => navigate(`/nfl/${teamId}${t === "roster" ? "" : `/${t}`}`, { replace: true });
  // coaches/{slug} docs currently on this team (see utils/coachHistory.js).
  const [staff, setStaff] = useState([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  // Mobile "stuck loading forever" watchdog — see the hook's own comment.
  useMobileStuckPageWatchdog(!team && loading, teamKey, { enabled: isMobile });
  const [seoDataReady, setSeoDataReady] = useState(false);
  const hoverTimeout = useRef(null);
  const tabsRef = useRef(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── Tells Prerender.io's headless browser when this page's data has
  // actually finished loading, instead of letting it guess via a fixed
  // timeout or the browser's `load` event. Same pattern as PlayerProfile.js,
  // TeamPage.js, and CommunityBoard.js. ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.prerenderReady = false;
    const safetyTimer = setTimeout(() => { window.prerenderReady = true; }, 8000);
    return () => clearTimeout(safetyTimer);
  }, [teamId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (seoDataReady) window.prerenderReady = true;
  }, [seoDataReady]);

  // Load Firestore team + picks
  useEffect(() => {
    if (!teamKey) return;
    setSeoDataReady(false);
    const loadData = async () => {
      try {
        const teamSnap = await getDoc(doc(db, "nfl", teamKey));
        if (!teamSnap.exists()) { setLoading(false); return; }
        const teamData = teamSnap.data();
        setTeam(teamData);
        const teamFullName = `${teamData.City} ${teamData.Team}`.trim();

        const picksQ = query(collection(db, "draftOrder"), where("Team", "==", teamKey), orderBy("Round"), orderBy("Pick"));
        const picksSnap = await getDocs(picksQ);
        const picksData = picksSnap.docs.map((d) => d.data());
        setPicks(picksData);

        // One query per drafted player, fired concurrently rather than
        // awaited one at a time — a full draft class's worth of picks
        // otherwise meant that many round trips in series before Draft
        // Picks had anything to show.
        const slugs = [...new Set(picksData.map((p) => p.Selection).filter((s) => typeof s === "string" && s.trim()))];
        const playerMap = {};
        await Promise.all(slugs.map(async (slug) => {
          const q = query(collection(db, "players"), where("Slug", "==", slug));
          const snap = await getDocs(q);
          if (!snap.empty) playerMap[slug] = snap.docs[0].data();
        }));
        setPlayersBySlug(playerMap);

        // Pre-2026 real draft picks for this team — same "historical"
        // collection/dedup shape TeamPage.js's own college archive reads
        // (see that file's own comment), just filtered by "NFL Team" (the
        // full "City Team" name the sheet stores there) instead of School.
        try {
          const histSnap = await getDocs(query(collection(db, "historical"), where("NFL Team", "==", teamFullName)));
          const histRaw = histSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((h) => h.Year && parseInt(h.Year) <= 2025);
          const seenPick = new Set();
          const seenName = new Set();
          const histPicks = histRaw.filter((h) => {
            const year = parseInt(h.Year);
            const pick = parseInt(h.Pick);
            if (pick && pick !== 999) {
              const pickKey = `${year}-${pick}`;
              if (seenPick.has(pickKey)) return false;
              seenPick.add(pickKey);
            }
            const name = (h.Player || "").trim().toLowerCase();
            if (name) {
              const nameKey = `${year}-${name}`;
              if (seenName.has(nameKey)) return false;
              seenName.add(nameKey);
            }
            return true;
          });
          setHistoricalPicks(histPicks);
        } catch (e) {
          console.error("Historical picks fetch error:", e);
          setHistoricalPicks([]);
        }

        setLoading(false);
      } finally {
        setSeoDataReady(true);
      }
    };
    loadData();
  }, [teamKey]);

  // "+" tile board popup — fetches the 2027 class for whichever
  // position(s) boardModal names, same "read players, average each one's
  // evaluations client-side" pattern PlayerProfile.js's own draft-class
  // fetch uses, just scoped to the position(s) instead of one player's own
  // position. Only runs while the popup is actually open.
  useEffect(() => {
    if (!boardModal) return;
    let cancelled = false;
    setBoardModalLoading(true);
    setBoardModalPlayers([]);
    // Fresh filters every time a group's popup opens — a Strengths pick
    // from one group's list wouldn't even mean anything against another.
    setBoardModalGradeFilter(new Set());
    setBoardModalStrengthFilter(new Set());
    setBoardModalFilterPanel(null);
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, "players"),
          where("Eligible", "==", "2027"),
          where("Position", "in", boardModal.positions)
        ));
        const list = await Promise.all(
          snap.docs
            .filter((d) => d.data().Live !== false)
            .map(async (d) => {
              const data = d.data();
              let avgGrade = null;
              // Strength tags tallied alongside grade in the same
              // evaluations read — same aggregation PlayerProfile.js's own
              // community.topStrengths does — so a player's own strength
              // filter matching doesn't need a second fetch pass.
              let strengths = [];
              try {
                const evalsSnap = await getDocs(collection(db, "players", d.id, "evaluations"));
                const grades = [];
                const sCounts = {};
                evalsSnap.forEach((ev) => {
                  const evData = ev.data();
                  if (evData.grade && gradeScale[evData.grade]) grades.push(gradeScale[evData.grade]);
                  if (Array.isArray(evData.strengths)) evData.strengths.forEach((s) => { sCounts[s] = (sCounts[s] || 0) + 1; });
                });
                if (grades.length > 0) avgGrade = grades.reduce((a, b) => a + b, 0) / grades.length;
                strengths = Object.entries(sCounts).sort((a, b) => b[1] - a[1]).map(([s]) => s);
              } catch { /* no evaluations yet — stays Watchlist, no strengths, below */ }
              return { id: d.id, First: data.First || "", Last: data.Last || "", School: data.School || "", Slug: data.Slug || "", Position: data.Position || "", avgGrade, strengths };
            })
        );
        list.sort((a, b) => {
          const av = a.avgGrade != null ? Math.round(a.avgGrade) : null;
          const bv = b.avgGrade != null ? Math.round(b.avgGrade) : null;
          if (av != null && bv != null) return av - bv;
          if (av != null) return -1;
          if (bv != null) return 1;
          return 0;
        });
        if (!cancelled) setBoardModalPlayers(list);
      } catch (e) {
        console.error("Board popup fetch error:", e);
        if (!cancelled) setBoardModalPlayers([]);
      } finally {
        if (!cancelled) setBoardModalLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [boardModal]);

  // Current staff — anyone whose derived CurrentTeams includes this team.
  useEffect(() => {
    if (!teamKey) return;
    let cancelled = false;
    setStaffLoading(true);
    getDocs(query(collection(db, "coaches"), where("CurrentTeams", "array-contains", teamKey)))
      .then((snap) => { if (!cancelled) setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); })
      .catch((e) => { console.error("Staff fetch error:", e); if (!cancelled) setStaff([]); })
      .finally(() => { if (!cancelled) setStaffLoading(false); });
    return () => { cancelled = true; };
  }, [teamKey]);

  // Match the roster to We-Draft player pages — batched by last name
  // ("in" takes 30 at a time), with and without a Jr./III suffix since
  // either side may carry it.
  useEffect(() => {
    if (!roster.length) return;
    let cancelled = false;
    const lasts = [...new Set(roster.flatMap((p) => [p.lastName, stripSuffix(p.lastName)]).filter(Boolean))];
    const chunks = [];
    for (let i = 0; i < lasts.length; i += 30) chunks.push(lasts.slice(i, i + 30));
    Promise.all(chunks.map((chunk) => getDocs(query(collection(db, "players"), where("Last", "in", chunk)))))
      .then((snaps) => {
        const maxYear = lastDraftYear();
        const candidates = snaps.flatMap((snap) => snap.docs.map((d) => d.data()))
          .filter((d) => d.Slug && d.Live !== false && parseInt(d.Eligible) <= maxYear);
        const found = {};
        roster.forEach((p) => {
          const matches = candidates.filter((d) => {
            const name = `${d.First || ""} ${d.Last || ""}`;
            if (depthNameKey(name) !== depthNameKey(p.fullName) && initialKey(name) !== initialKey(p.fullName)) return false;
            return !d.School || !p.college || schoolKey(d.School) === schoolKey(p.college);
          });
          const best = matches.find((d) => d.School && p.college) || matches[0];
          if (best) found[p.id] = best.Slug;
        });
        if (!cancelled) setProfileSlugs(found);
      })
      .catch((e) => console.error("Roster profile match error:", e));
    return () => { cancelled = true; };
  }, [roster]);

  // Snap order for the depth chart — missing (or unreadable) just leaves
  // each group in ESPN's own order.
  useEffect(() => {
    if (!teamKey) return;
    setDepthOrder(null);
    getDoc(doc(db, "nflDepthOrder", teamKey))
      .then((snap) => setDepthOrder(snap.exists() ? snap.data().order || [] : []))
      .catch((e) => { console.error("Depth order fetch error:", e); setDepthOrder([]); });
  }, [teamKey]);

  // Load ESPN roster
  useEffect(() => {
    if (!teamKey) return;
    const espnId = ESPN_TEAM_IDS[teamKey];
    if (!espnId) { setRosterLoading(false); return; }

    const fetchRoster = async () => {
      try {
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnId}/roster`);
        const data = await res.json();
        // ESPN returns athletes grouped by roster status (see statusTag)
        const athletes = (data.athletes || []).flatMap((group) =>
          (group.items || []).map((a) => ({
            id: a.id,
            firstName: a.firstName,
            lastName: a.lastName,
            fullName: a.fullName,
            position: a.position?.abbreviation || "",
            jersey: a.jersey || "",
            age: a.age,
            height: a.displayHeight,
            weight: a.displayWeight,
            experience: a.experience?.years ?? null,
            college: a.college?.name || "",
            headshot: a.headshot?.href || null,
            rosterStatus: ROSTER_GROUP_STATUS[group.position] || "active",
            injury: a.injuries?.[0]?.status || null,
            injuryDate: a.injuries?.[0]?.date || null,
          }))
        );
        setRoster(athletes);
      } catch (err) {
        console.error("ESPN roster fetch failed:", err);
      } finally {
        setRosterLoading(false);
      }
    };
    fetchRoster();
  }, [teamKey]);

  // ── Draft Archive: this team's actual picks across every year — 2026
  // (the just-completed, resolved draft, via picks/playersBySlug above)
  // plus every earlier year (historicalPicks above). Combined/sorted/
  // deduped the same way TeamPage.js's own college-side archive combines
  // its "2026 archive class" + "historical" sources. ──
  const draftArchive = useMemo(() => {
    const currentYearEntries = picks
      .filter((p) => p.Selection && playersBySlug[p.Selection])
      .map((p) => {
        const pl = playersBySlug[p.Selection];
        return {
          key: `cur-${p.Selection}`,
          year: 2026,
          round: parseInt(p.Round) || 0,
          pick: parseInt(p.Pick) || 9999,
          playerName: `${pl.First || ""} ${pl.Last || ""}`.trim(),
          position: pl.Position || "",
          school: pl.School || "",
          slug: pl.Slug || null,
        };
      });
    const historicalEntries = historicalPicks.map((h) => ({
      key: `hist-${h.id}`,
      year: parseInt(h.Year) || 0,
      round: parseInt(h.Round) || 0,
      pick: parseInt(h.Pick) || 9999,
      playerName: h.Player || "",
      position: h.Position || "",
      school: h.School || "",
      slug: null,
    }));
    return [...currentYearEntries, ...historicalEntries].sort(
      (a, b) => b.year - a.year || a.pick - b.pick
    );
  }, [picks, playersBySlug, historicalPicks]);

  // College logos for the archive rows (schools/{name}.Logo1).
  const archiveSchoolLogos = useSchoolLogos(draftArchive.map((e) => e.school));

  // Season stats for one player, on first hover/tap — the current season's
  // regular-season totals, else last season's (see currentSeason above).
  // Cached as { season, line } or null when neither season has anything.
  const fetchStats = async (athleteId, position) => {
    if (statsCache[athleteId] !== undefined || statsLoading[athleteId]) return;
    setStatsLoading((prev) => ({ ...prev, [athleteId]: true }));
    let result = null;
    try {
      const season = currentSeason();
      for (const yr of [season, season - 1]) {
        const res = await fetch(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${yr}/types/2/athletes/${athleteId}/statistics/0`);
        if (!res.ok) continue;
        const data = await res.json();
        const stats = indexStats(data?.splits?.categories);
        if (!stats.general?.gamesPlayed) continue;
        result = { season: yr, line: statLine(position, stats) };
        break;
      }
    } catch { /* network/CORS failure — card just shows no stats */ }
    setStatsCache((prev) => ({ ...prev, [athleteId]: result }));
    setStatsLoading((prev) => ({ ...prev, [athleteId]: false }));
  };

  const handleMouseEnter = (player) => {
    hoverTimeout.current = setTimeout(() => {
      setHoveredId(player.id);
      fetchStats(player.id, player.position);
    }, 200);
  };

  const handleMouseLeave = () => {
    clearTimeout(hoverTimeout.current);
    setHoveredId(null);
  };

  // Mobile has no hover — a tap opens the same card as a bottom sheet.
  const openPlayerSheet = (player) => {
    setSheetPlayer(player);
    fetchStats(player.id, player.position);
  };

  // Group roster by position group — active players first, then IR/
  // suspended, then the practice squad, each in depth chart (snap) order;
  // anyone not in nflDepthOrder keeps ESPN's order after everyone who is.
  const depthRank = depthRanker(depthOrder);
  const groupedRoster = {};
  const allGroupedPositions = new Set(Object.values(POSITION_GROUPS).flat());
  Object.entries(POSITION_GROUPS).forEach(([group, positions]) => {
    const members = roster
      .map((p, i) => ({ p, i, r: depthRank(p) }))
      .filter(({ p }) => positions.includes(p.position))
      .sort((a, b) => STATUS_TIER[a.p.rosterStatus] - STATUS_TIER[b.p.rosterStatus] || a.r - b.r || a.i - b.i)
      .map(({ p }) => p);
    if (members.length > 0) groupedRoster[group] = members;
  });
  const ungrouped = roster.filter((p) => !allGroupedPositions.has(p.position));
  const countBy = (...st) => roster.filter((p) => st.includes(p.rosterStatus)).length;
  const rosterCount = [
    `${countBy("active")} Active`,
    countBy("reserve", "suspended") ? `${countBy("reserve", "suspended")} Reserve` : null,
    countBy("ps") ? `${countBy("ps")} PS` : null,
  ].filter(Boolean).join(" · ");
  if (ungrouped.length > 0) groupedRoster["Other"] = ungrouped;

  // Blocks first paint only until the team doc itself resolves (the single
  // getDoc at the top of the load effect) — not the draft-picks query and
  // per-pick player lookups behind it, which the Draft Picks section below
  // gates on its own instead. Still falls back to this full-page spinner if
  // that first fetch fails outright (loading flips false via the effect's
  // own early return without team ever getting set), so a bad teamId still
  // correctly reaches "Team not found" below instead of spinning forever.
  if (!team && loading) return <LoadingSpinner label="Loading" size={56} minHeight="calc(60vh / var(--pz, 1))" />;

  if (!team) return (
    <div style={{ textAlign: "center", marginTop: 80, color: "red", fontWeight: 900 }}>Team not found</div>
  );

  const c1 = team.Color1 || BLUE;
  const c2 = team.Color2 || GOLD;
  const teamName = `${team.City} ${team.Team}`.trim();
  const metaDescription = `${teamName} NFL Draft Hub — mock drafts, player grades, and draft archives for the ${teamName}.`;
  const pageUrl = `https://we-draft.com/nfl/${teamId}${tab === "roster" ? "" : `/${tab}`}`;
  // LogoDark/WordmarkDark are the dark-background-safe branding variants
  // (see AdminPanel.js's branding manager) — read straight and better
  // against the hero's saturated team-color gradient than the plain Logo1
  // this used to be limited to; Wordmark/Logo2 are the light-background
  // fallbacks when a team doesn't have a dark variant uploaded yet.
  const heroLogo = team.LogoDark || team.Logo1;
  // Same faded-background-bleed role TeamPage.js's college hero gives its
  // own WordmarkDark — City/Team is always the actual foreground name
  // (see below), same as college's School/Mascot. The one difference:
  // a college hero with no wordmark just shows no background bleed at
  // all, while this one falls back to the team's own short Abbreviation
  // (AdminPanel.js's NFL branding manager field) as giant faded text
  // instead, so every team gets *some* background element.
  const heroWordmark = team.WordmarkDark || "";
  const heroAbbreviation = team.Abbreviation || teamKey;

  return (
    <>
      <style>{HERO_STYLE}</style>
      <Helmet>
        <title>{teamName} Draft Hub</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={`${teamName} Draft Hub`} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={`${teamName} Draft Hub`} />
        <meta name="twitter:description" content={metaDescription} />
      </Helmet>

      {/* Defaults to this team's own Homage ad. */}
      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={24} preferTeam={teamKey} />

      <div ref={contentRef} style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 24px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== HERO ===== */}
        {/* Same recipe/layout as TeamPage.js's college HeroCard: a
            color1→color2 blend with a drifting stripe texture + breathing
            spotlight, logo on the left, name block filling the middle,
            action button pinned to the right — instead of the old
            vertically-centered layout. City/Team is the actual foreground
            name (same role college's School/Mascot text plays); the
            wordmark/abbreviation is the faded background bleed, same spot
            college's own WordmarkDark bleed sits in. */}
        <div style={{
          position: "relative", overflow: "hidden", borderRadius: 14,
          border: `2px solid ${c2}`, marginBottom: 24,
          boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
          background: [
            "linear-gradient(rgba(0,0,0,0.38), rgba(0,0,0,0.38))",
            `linear-gradient(120deg, ${c1} 0%, ${c1} 40%, ${c2} 100%)`,
          ].join(", "),
          padding: isMobile ? "20px 16px" : "30px 32px",
        }}>
          <div aria-hidden="true" style={{
            position: "absolute", inset: "-20%", zIndex: 0, pointerEvents: "none",
            background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 2px, transparent 2px, transparent 40px)",
            animation: "wdNflHeroDrift 18s linear infinite",
          }} />
          <div aria-hidden="true" style={{
            position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
            background: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.18), transparent 55%)",
            animation: "wdNflHeroSpotlight 5s ease-in-out infinite",
          }} />
          {/* Giant faded background bleed — hidden on mobile, same as
              college's own wordmark bleed. WordmarkDark when a team has
              one uploaded, otherwise the short Abbreviation as huge faded
              type instead of no background element at all. */}
          {!isMobile && (
            heroWordmark ? (
              <img
                src={sanitizeUrl(heroWordmark)} alt="" aria-hidden="true"
                style={{
                  position: "absolute", top: "50%", right: "-4%", transform: "translateY(-50%)",
                  width: "65%", maxWidth: 620, height: "auto", objectFit: "contain",
                  opacity: 0.14, zIndex: 0, pointerEvents: "none",
                }}
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            ) : (
              <div aria-hidden="true" style={{
                position: "absolute", top: "50%", right: "-2%", transform: "translateY(-50%)",
                fontSize: "clamp(80px, 12vw, 200px)", fontWeight: 900, color: "#fff",
                opacity: 0.14, zIndex: 0, pointerEvents: "none", lineHeight: 1, letterSpacing: "0.02em",
              }}>
                {heroAbbreviation}
              </div>
            )
          )}

          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: isMobile ? 16 : 28 }}>
            {heroLogo && (
              <img src={sanitizeUrl(heroLogo)} alt={team.Team}
                style={{ flexShrink: 0, width: isMobile ? 84 : 150, height: isMobile ? 84 : 150, objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.45))" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: isMobile ? "clamp(18px, 6vw, 26px)" : "clamp(28px, 3.4vw, 44px)", fontWeight: 900, color: "rgba(255,255,255,0.88)", lineHeight: 1.05, letterSpacing: "0.02em", textTransform: "uppercase", wordBreak: "break-word", textShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
                {team.City}
              </div>
              <div style={{ fontSize: isMobile ? "clamp(28px, 8vw, 44px)" : "clamp(44px, 6vw, 72px)", fontWeight: 900, color: "#fff", lineHeight: 1.05, letterSpacing: "0.02em", textTransform: "uppercase", wordBreak: "break-word", textShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
                {team.Team}
              </div>
              <div style={{ marginTop: 10, display: "inline-block", background: "rgba(0,0,0,0.32)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontWeight: 900, fontSize: isMobile ? 11 : 13, padding: "4px 16px", borderRadius: 20, letterSpacing: "0.05em" }}>
                {team.Conference} · {team.Division}
              </div>
            </div>
            <button
              onClick={() => { setTab("archive"); tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
              style={{
                flexShrink: 0, background: c2, color: "#fff",
                border: "2px solid #fff", borderRadius: isMobile ? 6 : 8,
                padding: isMobile ? "6px 10px" : "10px 20px",
                fontWeight: 900, fontSize: isMobile ? 10 : 13,
                textTransform: "uppercase", letterSpacing: isMobile ? "0.04em" : "0.06em",
                cursor: "pointer", whiteSpace: "nowrap",
                boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
              }}
            >
              {isMobile ? "Archive ↓" : "Draft Archive ↓"}
            </button>
          </div>
        </div>

        {/* ===== TABS ===== */}
        <div ref={tabsRef} role="tablist" style={{ scrollMarginTop: 80, display: "flex", gap: isMobile ? 6 : 8, marginBottom: isMobile ? 18 : 24, borderBottom: `3px solid ${tint(c1, "1f")}` }}>
          {[["roster", "Depth Chart"], ["staff", "Staff"], ["archive", "Draft Archive"]].map(([key, label]) => {
            const active = tab === key;
            return (
              <button
                key={key} role="tab" aria-selected={active}
                onClick={() => setTab(key)}
                style={{
                  flex: isMobile ? 1 : "0 0 auto", marginBottom: -3,
                  padding: isMobile ? "10px 6px" : "11px 22px",
                  background: active ? c1 : "transparent", color: active ? "#fff" : c1,
                  border: "none", borderBottom: `3px solid ${active ? c2 : "transparent"}`,
                  borderRadius: "8px 8px 0 0", cursor: "pointer", fontFamily: "inherit",
                  fontWeight: 900, fontSize: isMobile ? 11 : 13, textTransform: "uppercase", letterSpacing: "0.07em",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* ===== DEPTH CHART ===== */}
        {/* ESPN's roster by position group, each group in depth chart order
            — season snaps (nflDepthOrder, see depthRanker above), never
            shown. */}
        {tab === "roster" && <div style={{ marginBottom: 32 }}>
          <SectionTitle color1={c1} color2={c2} isMobile={isMobile} right={roster.length ? rosterCount : null}>
            2026 Depth Chart
          </SectionTitle>

          {rosterLoading ? (
            <LoadingSpinner label="Loading roster" size={28} minHeight="140px" />
          ) : roster.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: 14 }}>Roster unavailable.</div>
          ) : (
            Object.entries(groupedRoster).map(([group, players]) => (
              <div key={group} style={{ marginBottom: isMobile ? 20 : 26 }}>
                <SectionTitle color1={c1} color2={c2} isMobile={isMobile} sub right={players.length}>{group}</SectionTitle>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(200px, 1fr))", gap: isMobile ? 8 : 10 }}>
                  {players.map((player) => (
                    <DepthChip
                      key={player.id} player={player} color1={c1} color2={c2} isMobile={isMobile}
                      hovered={hoveredId === player.id}
                      stats={statsCache[player.id]} statsLoading={!!statsLoading[player.id]}
                      onMouseEnter={() => handleMouseEnter(player)} onMouseLeave={handleMouseLeave}
                      onTap={() => openPlayerSheet(player)}
                      profileSlug={profileSlugs[player.id]}
                    />
                  ))}
                  {/* "+" tile — pops up that group's 2027 board right here
                      instead of navigating away (see boardModal above) —
                      omitted for a group with no board equivalent. */}
                  {ROSTER_GROUP_TO_BOARD_POSITIONS[group] && (
                    <button
                      className="wd-nfl-plus"
                      onClick={() => setBoardModal({ positions: ROSTER_GROUP_TO_BOARD_POSITIONS[group], label: ROSTER_GROUP_TO_BOARD_POSITIONS[group].join(" / ") })}
                      title={`See the 2027 ${ROSTER_GROUP_TO_BOARD_POSITIONS[group].join(" / ")} board`}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        minHeight: isMobile ? 56 : 62, padding: "8px 10px",
                        background: tint(c1, "0d"), border: `2px dashed ${tint(c1, "66")}`, borderRadius: 10,
                        color: c1, cursor: "pointer", boxSizing: "border-box", fontFamily: "inherit",
                      }}
                    >
                      <span style={{ fontSize: isMobile ? 22 : 26, fontWeight: 900, lineHeight: 1 }}>+</span>
                      <span style={{ fontSize: isMobile ? 10 : 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        2027 Board
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>}

        {/* ===== STAFF ===== */}
        {tab === "staff" && (
          <div style={{ marginBottom: 32 }}>
            <SectionTitle color1={c1} color2={c2} isMobile={isMobile}>Coaching Staff &amp; Front Office</SectionTitle>
            {staffLoading ? (
              <LoadingSpinner label="Loading staff" size={28} minHeight="140px" />
            ) : (
              <StaffList staff={staff} teamKey={teamKey} color1={c1} color2={c2} isMobile={isMobile} />
            )}
          </div>
        )}

        {/* ===== DRAFT ARCHIVE ===== */}
        {/* Every pick this team has actually made — 2026 (the just-
            completed draft, via draftOrder) plus real history before it
            (via the "historical" collection) — filterable by Year/Round/
            Position the same way TeamPage.js's own college-side "NFL Draft
            History" archive is, just built around one fixed NFL team
            instead of one fixed college. See draftArchive/archiveSchoolLogos
            above for how the two sources are combined. */}
        {tab === "archive" && <>
        <SectionTitle color1={c1} color2={c2} isMobile={isMobile}>Draft Archive</SectionTitle>

        <div style={{ borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2" }}>
          <div style={{ background: c1, padding: "8px 16px" }}>
            <div style={{ color: c2, fontWeight: 900, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {loading ? "Loading…" : `${draftArchive.length} Pick${draftArchive.length !== 1 ? "s" : ""}`}
            </div>
          </div>
          <div style={{ height: 3, background: c2 }} />

          {loading ? (
            <div style={{ padding: 32, background: "#fff" }}>
              <LoadingSpinner label="Loading picks" size={24} minHeight="80px" />
            </div>
          ) : (
            <DraftArchiveList
              archive={draftArchive} schoolLogos={archiveSchoolLogos}
              isMobile={isMobile} color1={c1} color2={c2}
            />
          )}
        </div>
        </>}

      </div>

      {/* ===== MOBILE PLAYER SHEET ===== */}
      {sheetPlayer && (
        <div
          onClick={() => setSheetPlayer(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, padding: "0 10px 14px", boxSizing: "border-box" }}>
            <PlayerCard
              player={sheetPlayer} color1={c1} color2={c2}
              stats={statsCache[sheetPlayer.id]} statsLoading={!!statsLoading[sheetPlayer.id]}
              onClose={() => setSheetPlayer(null)}
              profileSlug={profileSlugs[sheetPlayer.id]}
            />
          </div>
        </div>
      )}

      {/* ===== "+" TILE BOARD POPUP ===== */}
      {boardModal && (
        <div
          onClick={() => setBoardModal(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 12 : 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", border: `3px solid ${c2}`, borderRadius: 12,
              maxWidth: 520, width: "100%",
              // Fixed, not maxHeight — the popup stays the same size
              // regardless of result count, loading state, or how much a
              // filter narrows the list, instead of shrinking/growing
              // around whatever's currently inside it.
              height: isMobile ? "calc(80vh / var(--pz, 1))" : 640,
              display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ background: c1, padding: "14px 18px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 15 : 17, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  2027 {boardModal.label} Board
                </div>
                <Link
                  to={`/community/2027/${boardModal.positions.join(",").toLowerCase()}`}
                  onClick={() => setBoardModal(null)}
                  style={{ color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: 700, textDecoration: "underline" }}
                >
                  Open Full Board ↗
                </Link>
              </div>
              <button
                onClick={() => setBoardModal(null)}
                style={{ flexShrink: 0, background: "none", border: "none", color: "#fff", fontSize: 26, cursor: "pointer", lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
            <div style={{ height: 3, background: c2, flexShrink: 0 }} />

            {!boardModalLoading && boardModalPlayers.length > 0 && (() => {
              // Grade label computed once here (not per filter-check) since
              // both the filter's own option list and the actual filtering
              // below need it. Strengths options are just whichever terms
              // this specific result set's evaluations actually used —
              // ranked by how often they show up, most-common first,
              // instead of every trait the "traits" collection ever offers
              // regardless of relevance to this group.
              const withLabel = boardModalPlayers.map((p) => {
                const gradeLabel = p.avgGrade != null ? (gradeLabels[Math.round(p.avgGrade)] || "Watchlist") : "Watchlist";
                return { ...p, gradeLabel, roundBucket: ROUND_BUCKET[gradeLabel] || gradeLabel };
              });
              const strengthCounts = {};
              withLabel.forEach((p) => p.strengths.forEach((s) => { strengthCounts[s] = (strengthCounts[s] || 0) + 1; }));
              const strengthOptions = Object.entries(strengthCounts).sort((a, b) => b[1] - a[1]).map(([s]) => s);
              const hasFilters = boardModalGradeFilter.size > 0 || boardModalStrengthFilter.size > 0;
              const filtered = withLabel.filter((p) => {
                // Grade stays OR (a player only ever has the one grade, so
                // checking more than one broadens which grades count).
                // Strengths is AND — checking Arm Strength and Running
                // Ability should narrow to players with both, not either,
                // since a player can genuinely have several at once.
                if (boardModalGradeFilter.size > 0 && !boardModalGradeFilter.has(p.roundBucket)) return false;
                if (boardModalStrengthFilter.size > 0 && ![...boardModalStrengthFilter].every((s) => p.strengths.includes(s))) return false;
                return true;
              });

              return (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 16px", background: "#f7f8fa", borderBottom: "1px solid #e8e8e8" }}>
                    <ArchiveFilterButton
                      label="Grade" options={roundOrder} panelKey="grade" activeSet={boardModalGradeFilter}
                      onToggle={(v) => setBoardModalGradeFilter((prev) => { const next = new Set(prev); next.has(v) ? next.delete(v) : next.add(v); return next; })}
                      onClearGroup={() => setBoardModalGradeFilter(new Set())}
                      color1={c1} color2={c2} openPanel={boardModalFilterPanel} setOpenPanel={setBoardModalFilterPanel}
                    />
                    {strengthOptions.length > 0 && (
                      <ArchiveFilterButton
                        label="Strengths" options={strengthOptions} panelKey="strengths" activeSet={boardModalStrengthFilter}
                        onToggle={(v) => setBoardModalStrengthFilter((prev) => { const next = new Set(prev); next.has(v) ? next.delete(v) : next.add(v); return next; })}
                        onClearGroup={() => setBoardModalStrengthFilter(new Set())}
                        color1={c1} color2={c2} openPanel={boardModalFilterPanel} setOpenPanel={setBoardModalFilterPanel}
                      />
                    )}
                    {hasFilters && (
                      <button
                        onClick={() => { setBoardModalGradeFilter(new Set()); setBoardModalStrengthFilter(new Set()); }}
                        style={{ border: "2px solid #ccc", borderRadius: 6, padding: "5px 12px", fontWeight: 900, fontSize: 11, color: "#888", background: "#fff", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em" }}
                      >
                        Clear
                      </button>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#aaa" }}>
                      {filtered.length} of {boardModalPlayers.length}
                    </span>
                  </div>

                  <div style={{ overflowY: "auto", flex: 1 }}>
                    {filtered.length === 0 ? (
                      <div style={{ padding: 32, textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: 14 }}>No prospects match these filters.</div>
                    ) : (
                      filtered.map((p, i) => {
                        const gd = gradeDisplay(p.gradeLabel);
                        return (
                          <Link
                            key={p.id}
                            to={`/player/${p.Slug}`}
                            onClick={() => setBoardModal(null)}
                            style={{
                              display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", textDecoration: "none",
                              borderBottom: i < filtered.length - 1 ? "1px solid #f0f0f0" : "none",
                              background: "#fff",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#f7f9fc"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                          >
                            <div style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 6, background: gd.bg, border: `2px solid ${gd.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 900 }}>
                              {gd.short}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 900, fontSize: 14, color: c1, textTransform: "uppercase", letterSpacing: "0.03em" }}>{p.First} {p.Last}</div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#777", marginTop: 1 }}>{p.Position} · {p.School}</div>
                              {p.strengths.length > 0 && (
                                <div style={{ fontSize: 10, fontWeight: 700, color: "#999", marginTop: 2 }}>{p.strengths.slice(0, 2).join(" · ")}</div>
                              )}
                            </div>
                          </Link>
                        );
                      })
                    )}
                  </div>
                </>
              );
            })()}

            {boardModalLoading && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <LoadingSpinner label="Loading board" size={24} minHeight="80px" />
              </div>
            )}
            {!boardModalLoading && boardModalPlayers.length === 0 && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: 14 }}>No prospects yet.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── One depth chart player: jersey badge in the team colors, name, and
// position + experience. Hovering (desktop) opens his
// PlayerCard above the chip — or below it near the top of the window; a tap
// (mobile) opens the same card as a bottom sheet instead. ──
const expLabel = (exp) => (exp === 0 ? "Rookie" : exp != null ? `${exp} yr${exp !== 1 ? "s" : ""} exp` : null);

function DepthChip({ player, color1, color2, isMobile, hovered, stats, statsLoading, onMouseEnter, onMouseLeave, onTap, profileSlug }) {
  const chipRef = useRef(null);
  const [place, setPlace] = useState({ below: false, align: "center" });
  const expStr = expLabel(player.experience);
  const tag = statusTag(player);
  // Off the active roster: IR/suspended chips go grey, practice squad gets
  // an outlined number instead of the solid team-color one.
  const inactive = player.rosterStatus === "reserve" || player.rosterStatus === "suspended";
  const ps = player.rosterStatus === "ps";

  const handleEnter = () => {
    if (isMobile) return;
    const r = chipRef.current?.getBoundingClientRect();
    if (r) {
      setPlace({
        below: r.top < 340,
        align: r.left < 60 ? "left" : window.innerWidth - r.right < 60 ? "right" : "center",
      });
    }
    onMouseEnter();
  };

  const cardPos = {
    ...(place.below ? { top: "calc(100% + 8px)" } : { bottom: "calc(100% + 8px)" }),
    ...(place.align === "left" ? { left: 0 } : place.align === "right" ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" }),
  };

  // Desktop: a player with a We-Draft page is a real link to it. Mobile
  // keeps the tap-for-card sheet, which carries the profile link instead.
  const linked = profileSlug && !isMobile;
  const Wrapper = linked ? Link : "div";

  return (
    <Wrapper
      ref={chipRef}
      className="wd-nfl-chip"
      {...(linked ? { to: `/player/${profileSlug}` } : {})}
      onMouseEnter={handleEnter}
      onMouseLeave={isMobile ? undefined : onMouseLeave}
      onClick={isMobile ? onTap : undefined}
      style={{ textDecoration: "none", color: "inherit",
        position: "relative", zIndex: hovered ? 30 : undefined,
        display: "flex", alignItems: "center", gap: isMobile ? 8 : 10,
        padding: isMobile ? "8px" : "9px 10px", background: inactive ? "#f6f7f9" : "#fff", borderRadius: 12, minWidth: 0,
        boxShadow: hovered ? `0 10px 22px rgba(0,40,90,0.14), 0 0 0 1.5px ${color1}` : "0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2",
        cursor: isMobile || linked ? "pointer" : "default",
      }}
    >
      <div style={{
        flexShrink: 0, width: isMobile ? 34 : 40, height: isMobile ? 34 : 40, borderRadius: 9,
        background: inactive ? "#aab3bf" : ps ? "#fff" : color1,
        border: ps ? `2px solid ${tint(color1, "80")}` : "none", boxSizing: "border-box",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: ps ? color1 : "#fff", fontWeight: 900, fontSize: isMobile ? 14 : 16, fontVariantNumeric: "tabular-nums",
        textShadow: ps ? "none" : "0 1px 2px rgba(0,0,0,0.35)",
      }}>
        {player.jersey || "–"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: isMobile ? 9 : 10, fontWeight: 700, color: "#6b7685", textTransform: "uppercase", letterSpacing: "0.05em", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {player.firstName}
        </div>
        <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: 900, color: inactive ? "#6b7685" : "#1a1f2b", textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {player.lastName}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, minWidth: 0 }}>
          {player.position && (
            <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 900, color: "#fff", background: inactive ? "#aab3bf" : color1, borderRadius: 4, padding: "1px 5px", letterSpacing: "0.05em" }}>
              {player.position}
            </span>
          )}
          {tag && <StatusPill tag={tag} />}
          {expStr && (
            <span style={{ fontSize: 9, fontWeight: 700, color: "#9aa5b4", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{expStr}</span>
          )}
        </div>
      </div>

      {hovered && !isMobile && (
        <div style={{ position: "absolute", ...cardPos, width: 300, zIndex: 100, pointerEvents: "none" }}>
          <PlayerCard player={player} color1={color1} color2={color2} stats={stats} statsLoading={statsLoading} profileSlug={profileSlug} />
        </div>
      )}
    </Wrapper>
  );
}

function StatusPill({ tag }) {
  const t = STATUS_TONES[tag.tone];
  return (
    <span title={tag.label} style={{
      flexShrink: 0, fontSize: 9, fontWeight: 900, letterSpacing: "0.05em", borderRadius: 4, padding: "1px 5px",
      color: t.fg, background: t.bg, boxShadow: t.border ? `inset 0 0 0 1px ${t.border}` : "none",
    }}>
      {tag.short}
    </span>
  );
}

// ── Player card — the depth chart hover popup (desktop) and tap sheet
// (mobile): team-color header with the headshot, bio tiles, then this
// season's stat line (see statLine above). ──
function PlayerCard({ player, color1, color2, stats, statsLoading, onClose, profileSlug }) {
  const [imgFailed, setImgFailed] = useState(false);
  const weightClean = player.weight ? player.weight.toString().replace(/\s*lbs\.?/i, "").trim() : null;
  const bio = [
    player.age ? ["Age", player.age] : null,
    player.height ? ["Ht", player.height] : null,
    weightClean ? ["Wt", weightClean] : null,
    ["Exp", player.experience === 0 ? "R" : player.experience ?? "–"],
  ].filter(Boolean);
  const photo = !imgFailed && player.headshot ? headshotUrl(player.headshot, 260) : null;
  const tag = statusTag(player);
  const injuryDate = player.injuryDate && player.rosterStatus !== "ps"
    ? new Date(player.injuryDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 16px 40px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.06)", fontFamily: "'Arial Black', Arial, sans-serif" }}>
      <div style={{
        position: "relative", minHeight: 104, overflow: "hidden",
        background: [
          "linear-gradient(rgba(0,0,0,0.28), rgba(0,0,0,0.28))",
          `linear-gradient(120deg, ${color1} 0%, ${color1} 45%, ${color2} 100%)`,
        ].join(", "),
      }}>
        {player.jersey && (
          <div aria-hidden="true" style={{ position: "absolute", right: photo ? 108 : 14, top: -6, fontSize: 84, fontWeight: 900, color: "#fff", opacity: 0.12, lineHeight: 1 }}>
            {player.jersey}
          </div>
        )}
        {photo && (
          <img
            src={photo} alt="" onError={() => setImgFailed(true)}
            style={{ position: "absolute", right: -6, bottom: 0, height: 104, width: "auto", filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.35))" }}
          />
        )}
        <div style={{ position: "relative", padding: "14px 14px 12px", paddingRight: photo ? 140 : 14 }}>
          <div style={{ fontSize: 10, fontWeight: 900, color: "rgba(255,255,255,0.8)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {[player.jersey ? `#${player.jersey}` : null, player.position].filter(Boolean).join(" · ")}
          </div>
          <div style={{ marginTop: 3, fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.1 }}>
            {player.firstName}
          </div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.05, textShadow: "0 2px 6px rgba(0,0,0,0.35)", wordBreak: "break-word" }}>
            {player.lastName}
          </div>
          {player.college && (
            <div style={{ marginTop: 6, fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>{player.college}</div>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose} aria-label="Close"
            style={{ position: "absolute", top: 6, right: 8, background: "rgba(0,0,0,0.35)", border: "none", borderRadius: 999, width: 28, height: 28, color: "#fff", fontSize: 18, lineHeight: 1, cursor: "pointer", zIndex: 2 }}
          >
            ×
          </button>
        )}
      </div>
      <div style={{ height: 3, background: color2 }} />

      {tag && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 12px",
          background: tag.tone === "ps" ? "#f3f5f8" : tag.tone === "warn" ? "#fdf5e1" : "#fbeceb",
          color: tag.tone === "ps" ? "#5f6b7a" : tag.tone === "warn" ? "#8a6100" : "#a12d22",
          fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          <span>{tag.label}</span>
          {injuryDate && <span style={{ fontWeight: 700, letterSpacing: "0.04em" }}>{injuryDate}</span>}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${bio.length}, 1fr)`, borderBottom: "1px solid #eef1f5" }}>
        {bio.map(([label, value], i) => (
          <div key={label} style={{ padding: "8px 4px", textAlign: "center", borderLeft: i ? "1px solid #eef1f5" : "none" }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: "#1a1f2b", whiteSpace: "nowrap" }}>{value}</div>
            <div style={{ fontSize: 8, fontWeight: 900, color: "#9aa5b4", letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 1 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: "10px 12px 12px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 }}>
          <span style={{ fontSize: 10, fontWeight: 900, color: color1, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {stats ? `${stats.season} Season` : "Season Stats"}
          </span>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#9aa5b4" }}>Regular season</span>
        </div>
        {statsLoading || stats === undefined ? (
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9aa5b4", padding: "8px 0" }}>Loading stats…</div>
        ) : !stats ? (
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9aa5b4", padding: "8px 0" }}>No regular-season stats yet.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {stats.line.map(({ label, value }) => (
              <div key={label} style={{ background: tint(color1, "0d"), borderRadius: 8, padding: "7px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 900, color: "#1a1f2b", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{value}</div>
                <div style={{ fontSize: 8, fontWeight: 900, color: color1, letterSpacing: "0.1em", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hover card: the chip itself is the link, so just say so. Sheet
          (onClose set): an actual button. */}
      {profileSlug && (onClose ? (
        <Link
          to={`/player/${profileSlug}`}
          style={{ display: "block", margin: "0 12px 12px", padding: "10px", borderRadius: 8, background: color1, color: "#fff", textAlign: "center", textDecoration: "none", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          View We-Draft Profile →
        </Link>
      ) : (
        <div style={{ padding: "7px 12px", borderTop: "1px solid #eef1f5", fontSize: 9, fontWeight: 900, color: color1, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "center" }}>
          Click for We-Draft profile →
        </div>
      ))}
    </div>
  );
}

// ── Staff tab — everyone coaches/{slug} lists as currently holding a
// tracked job (HC/OC/DC/GM, see TRACKED_ROLES in utils/coachHistory.js) on
// this team, head coach first, each with their career path newest-first. ──
const STAFF_ROLE_ORDER = ["HC", "IHC", "GM", "OC", "DC"];

function StaffList({ staff, teamKey, color1, color2, isMobile }) {
  const people = staff
    .map((person) => {
      const roles = (person.Current || []).filter((c) => c.Team === teamKey).map((c) => c.Role)
        .sort((a, b) => STAFF_ROLE_ORDER.indexOf(a) - STAFF_ROLE_ORDER.indexOf(b));
      return { person, roles };
    })
    .filter(({ roles }) => roles.length)
    .sort((a, b) => STAFF_ROLE_ORDER.indexOf(a.roles[0]) - STAFF_ROLE_ORDER.indexOf(b.roles[0]));

  if (!people.length) {
    return <div style={{ padding: 40, textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: 14 }}>Staff not on file yet.</div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: isMobile ? 12 : 16, alignItems: "start" }}>
      {people.map(({ person, roles }) => (
        <StaffCard key={person.id} person={person} roles={roles} teamKey={teamKey} color1={color1} color2={color2} isMobile={isMobile} />
      ))}
    </div>
  );
}

// One person: role pills + name + "Since" in a team-color header, college,
// then the career path — NFL head coach/coordinator/GM jobs bold, the
// current job(s) here dated in the team color.
function StaffCard({ person, roles, teamKey, color1, color2, isMobile }) {
  const [expanded, setExpanded] = useState(false);
  const stints = [...(person.Stints || [])].reverse();
  const isHere = (s) => s.Level === "NFL" && s.Team === teamKey && isOpenStint(s);
  const since = stints
    .filter((s) => isHere(s) && s.Roles?.some((r) => roles.includes(r)))
    .map((s) => s.StartYear).filter(Boolean).sort((a, b) => a - b)[0];
  const groups = groupStints(stints);
  // Head coaches and GMs get a /staff/ draft-history page.
  const hasPage = roles.some((r) => ["HC", "IHC", "GM"].includes(r));
  const SHOWN = 4;
  const visible = expanded ? groups : groups.slice(0, SHOWN);
  const facts = [
    person.College ? ["College", person.College] : null,
  ].filter(Boolean);

  return (
    <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2" }}>
      <div style={{
        padding: isMobile ? "12px 14px" : "14px 18px",
        background: [
          "linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.3))",
          `linear-gradient(120deg, ${color1} 0%, ${color1} 50%, ${color2} 100%)`,
        ].join(", "),
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {roles.map((r) => (
            <span key={r} style={{ fontSize: 10, fontWeight: 900, color: "#fff", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.35)", borderRadius: 999, padding: "2px 10px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {ROLE_BY_KEY[r]?.label || r}
            </span>
          ))}
        </div>
        <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.1, textShadow: "0 2px 6px rgba(0,0,0,0.35)" }}>
            {hasPage ? (
              <Link to={`/staff/${person.id}`} style={{ color: "inherit", textDecoration: "none" }}>{person.Name}</Link>
            ) : person.Name}
          </div>
          {since && (
            <div style={{ flexShrink: 0, fontSize: 10, fontWeight: 900, color: "rgba(255,255,255,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Since {since}
            </div>
          )}
        </div>
      </div>
      <div style={{ height: 3, background: color2 }} />

      {hasPage && (
        <Link
          to={`/staff/${person.id}`}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: isMobile ? "9px 14px" : "9px 18px", background: tint(color1, "0d"), borderBottom: "1px solid #eef1f5", color: color1, textDecoration: "none", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          <span>Draft History</span>
          <span>→</span>
        </Link>
      )}

      {facts.length > 0 && (
        <div style={{ padding: isMobile ? "10px 14px" : "10px 18px", display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid #eef1f5" }}>
          {facts.map(([label, value]) => (
            <div key={label} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ flexShrink: 0, width: 54, fontSize: 9, fontWeight: 900, color: color1, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#3a4352", lineHeight: 1.35, fontFamily: "Arial, sans-serif" }}>{value}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: isMobile ? "10px 14px 12px" : "12px 18px 14px" }}>
        <div style={{ fontSize: 10, fontWeight: 900, color: "#9aa5b4", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Career Path</div>
        {visible.map((g, gi) => (
          <div key={gi} style={{ padding: "7px 0", borderTop: gi ? "1px solid #eef1f5" : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 3 }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: "#1a1f2b", fontFamily: "Arial, sans-serif", lineHeight: 1.3 }}>{g.org}</span>
              {g.span && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 900, color: "#9aa5b4", fontVariantNumeric: "tabular-nums" }}>{g.span}</span>}
            </div>
            {g.stints.map((s, i) => {
              const key = s.Level === "NFL" && s.Roles?.some((r) => STAFF_ROLE_ORDER.includes(r));
              return (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "2px 0" }}>
                  <span style={{ flexShrink: 0, width: isMobile ? 84 : 96, fontSize: 11, fontWeight: 900, color: isHere(s) ? color1 : "#9aa5b4", fontVariantNumeric: "tabular-nums" }}>
                    {stintYearSpan(s)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: "Arial, sans-serif", lineHeight: 1.35, fontWeight: key ? 700 : 400, color: key ? "#1a1f2b" : "#5a6474" }}>
                    {s.Title || s.Roles?.map((r) => ROLE_BY_KEY[r]?.label || r).join(" / ")}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {groups.length > SHOWN && (
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{ marginTop: 6, background: "none", border: "none", padding: 0, color: color1, fontWeight: 900, fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "inherit" }}
          >
            {expanded ? "Show less ↑" : `Full career (${groups.length} stops) ↓`}
          </button>
        )}
      </div>
    </div>
  );
}
