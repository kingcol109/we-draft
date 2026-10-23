import { useParams, useNavigate, Link } from "react-router-dom";
import { Fragment, useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import {
  doc, getDoc, collection, query, where, getDocs, orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import Logo1 from "../assets/Logo1.png";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import MarginAds from "../components/MarginAds";
import { useMobileStuckPageWatchdog } from "../hooks/useMobileStuckPageWatchdog";
import DraftArchiveList, { useSchoolLogos } from "../components/DraftArchiveList";
import ProjectedPicks from "../components/ProjectedPicks";
import NFLTeamRail from "../components/NFLTeamRail";
import UpcomingPicks, { fetchTeamDraftCapital, capitalSentence } from "../components/UpcomingPicks";
import { ORDER_YEAR } from "../utils/draftOrder";
import { fetchTeamTargets } from "../utils/draftProfileData";
import { viewportCssWidth } from "../utils/pageZoom";
import { ROLE_BY_KEY, isOpenStint, isPlayerStint, stintYearSpan, groupStints } from "../utils/coachHistory";
import { textOn } from "../utils/teamColors";
import { depthNameKey, initialKey, fetchEspnRoster, fetchDepthOrder, groupRoster } from "../utils/nflRoster";

const BLUE = "#0055a5";

// Page titles — the main page's is its search title.
const TEAM_TAB_TITLES = {
  targets: (t) => `${t} Draft Targets and Projected Picks`,
  picks: (t) => `${t} Draft Order and ${ORDER_YEAR} Picks`,
  staff: (t) => `${t} Coaching Staff and Front Office`,
  depth: (t) => `${t} Depth Chart`,
  history: (t) => `${t} Draft History`,
};

// Meta description: as many of the staff's top fits in the next class
// (_teamTargets) as fit in ~160 characters.
function teamDescription(teamName, nickname, year, targets) {
  const lead = `${teamName} draft targets and projected picks.`;
  const label = (t) => `${t.F} ${t.L} (${[t.S, t.P].filter(Boolean).join(" ")})`;
  for (let n = Math.min(3, targets.length); n > 0; n--) {
    const names = targets.slice(0, n).map(label);
    const list = n === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[n - 1]}`;
    const text = `${lead} Top ${year} fits for the ${nickname}: ${list}.`;
    if (text.length <= 160) return text;
  }
  return `${lead} The ${year} prospects who fit the ${nickname}' staff, every pick they own, and their full draft history.`;
}
// Same layout as the player pages: when the window has room, the team rail
// sits in a side column left of the centered page column, with a matching
// empty column on the right so the page stays centered, and the margin ads
// go in the gutters outside both.
const COLUMN_WIDTH = 1000;
const RAIL_WIDTH = 180;
const RAIL_GAP = 16;
const SIDE = RAIL_WIDTH + RAIL_GAP;
const railFits = () => viewportCssWidth() >= COLUMN_WIDTH + 2 * SIDE + 32;
const GOLD = "#f6a21d";

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
  @media (prefers-reduced-motion: reduce) {
    .wd-nfl-chip { transition: none !important; }
    .wd-nfl-chip:hover { transform: none; }
  }
`;

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
  const [roster, setRoster] = useState([]);
  // nflDepthOrder/{abbr}.order — see depthRanker in utils/nflRoster.js.
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
  // Page tab — Targets (the default) at the bare /nfl/{team}, then
  // /nfl/{team}/staff, /depth (depth chart), /picks (projected picks),
  // /history. Old addresses: /targets (now the bare URL), /archive (Draft
  // History).
  const LEGACY_TABS = { targets: "", archive: "/history" };
  const TAB_PATH = { targets: "", picks: "/picks", staff: "/staff", depth: "/depth", history: "/history" };
  const tab = ["picks", "staff", "depth", "history"].includes(tabParam) ? tabParam : "targets";
  // The Targets data (teamTargets_{TEAM}, shared/cached with the Targets
  // tab) — its next-class rows feed the meta description and the targets
  // paragraph at the bottom.
  const [teamTargets, setTeamTargets] = useState(null);
  const setTab = (t) => navigate(`/nfl/${teamId}${TAB_PATH[t]}`, { replace: true });
  useEffect(() => {
    if (tabParam in LEGACY_TABS) navigate(`/nfl/${teamId}${LEGACY_TABS[tabParam]}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam, teamId]);
  // coaches/{slug} docs currently on this team (see utils/coachHistory.js).
  const [staff, setStaff] = useState([]);
  const [staffState, setStaffLoading] = useState(true);
  // The team the loaded staff belongs to. On a team switch the first render
  // still holds the old team's staff — treat that as loading, not "no staff".
  const [staffFor, setStaffFor] = useState(null);
  const staffLoading = staffState || staffFor !== teamKey;
  // Next draft's capital, for the Projected Picks tab's meta description
  // (same cached reads the tab itself makes).
  const [draftCapital, setDraftCapital] = useState(null);
  useEffect(() => {
    if (tab !== "picks" || !teamKey) return;
    let cancelled = false;
    fetchTeamDraftCapital(teamKey).then((d) => { if (!cancelled) setDraftCapital(d[0]); }).catch(() => {});
    return () => { cancelled = true; };
  }, [tab, teamKey]);
  useEffect(() => {
    if (staffLoading || !teamKey) return;
    let cancelled = false;
    fetchTeamTargets(teamKey, staff).then((d) => { if (!cancelled) setTeamTargets(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [teamKey, staff, staffLoading]);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [showRail, setShowRail] = useState(() => typeof window !== "undefined" && railFits());
  // Mobile "stuck loading forever" watchdog — see the hook's own comment.
  useMobileStuckPageWatchdog(!team && loading, teamKey, { enabled: isMobile });
  const [seoDataReady, setSeoDataReady] = useState(false);
  const hoverTimeout = useRef(null);
  const tabsRef = useRef(null);

  useEffect(() => {
    const handler = () => { setIsMobile(window.innerWidth < 768); setShowRail(railFits()); };
    window.addEventListener("resize", handler);
    window.addEventListener("pagezoomchange", handler);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("pagezoomchange", handler);
    };
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

  // Current staff — anyone whose derived CurrentTeams includes this team.
  useEffect(() => {
    if (!teamKey) return;
    let cancelled = false;
    setStaffLoading(true);
    getDocs(query(collection(db, "coaches"), where("CurrentTeams", "array-contains", teamKey)))
      .then((snap) => { if (!cancelled) setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); })
      .catch((e) => { console.error("Staff fetch error:", e); if (!cancelled) setStaff([]); })
      .finally(() => { if (!cancelled) { setStaffFor(teamKey); setStaffLoading(false); } });
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
    fetchDepthOrder(teamKey)
      .then(setDepthOrder)
      .catch((e) => { console.error("Depth order fetch error:", e); setDepthOrder([]); });
  }, [teamKey]);

  // Load ESPN roster
  useEffect(() => {
    if (!teamKey) return;
    fetchEspnRoster(teamKey)
      .then(setRoster)
      .catch((err) => console.error("ESPN roster fetch failed:", err))
      .finally(() => setRosterLoading(false));
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
  const groupedRoster = groupRoster(roster, depthOrder);
  const countBy = (...st) => roster.filter((p) => st.includes(p.rosterStatus)).length;
  const rosterCount = [
    `${countBy("active")} Active`,
    countBy("reserve", "suspended") ? `${countBy("reserve", "suspended")} Reserve` : null,
    countBy("ps") ? `${countBy("ps")} PS` : null,
  ].filter(Boolean).join(" · ");

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
  const targetsYear = teamTargets?.eligible || "2027";
  // Top five staff fits in the next class, two per position at most.
  const targets = (() => {
    const perPos = {};
    return (teamTargets?.rows || []).filter((t) => {
      if (t.E !== targetsYear || (perPos[t.P] || 0) >= 2) return false;
      perPos[t.P] = (perPos[t.P] || 0) + 1;
      return true;
    }).slice(0, 5);
  })();
  const pageTitle = TEAM_TAB_TITLES[tab](teamName);
  // The Projected Picks tab is its own landing page: its description is the
  // tab's summary sentence for the next draft.
  const metaDescription = tab === "picks" && draftCapital
    ? capitalSentence(teamName, draftCapital)
    : teamDescription(teamName, team.Team, targetsYear, targets);
  const pageUrl = `https://we-draft.com/nfl/${teamId}${TAB_PATH[tab]}`;
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
  // No dark wordmark uploaded → the regular one, shown as-is at the same
  // low opacity (a white-silhouette filter flattened wordmarks with white
  // lettering, like the Patriots', into a solid cut-out shape).
  const heroWordmark = team.WordmarkDark || team.Wordmark || "";
  const rail = showRail && !isMobile;
  const heroAbbreviation = team.Abbreviation || teamKey;

  return (
    <>
      <style>{HERO_STYLE}</style>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={metaDescription} />
      </Helmet>

      {/* Defaults to this team's own Homage ad. */}
      {/* The ads measure the whole footprint — side columns included — so
          they sit outside the team rail. */}
      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={rail ? 0 : 24} preferTeam={teamKey} watch={[rail]} />

      <div ref={contentRef} style={{ position: "relative", maxWidth: rail ? COLUMN_WIDTH + 2 * SIDE : COLUMN_WIDTH, margin: "0 auto", padding: rail ? `0 ${SIDE}px` : 0, boxSizing: "border-box" }}>
      {/* A full-height strip in the left side column, so the rail's sticky
          positioning has the whole page to travel. */}
      {rail && (
        <div style={{ position: "absolute", top: 24, bottom: 60, left: 0, width: RAIL_WIDTH }}>
          <NFLTeamRail currentTeam={teamKey} tabSuffix={TAB_PATH[tab]} color1={c1} />
        </div>
      )}
      <div style={{ maxWidth: COLUMN_WIDTH, margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 24px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

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
              {/* One line, shrunk only as far as it takes to fit — long
                  nicknames (Commanders, Buccaneers) used to break mid-word. */}
              <FitText max={isMobile ? 40 : 72} min={isMobile ? 16 : 30} style={{ fontWeight: 900, color: "#fff", lineHeight: 1.05, letterSpacing: "0.02em", textTransform: "uppercase", textShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
                {team.Team}
              </FitText>
              <div style={{ marginTop: 10, display: "inline-block", background: "rgba(0,0,0,0.32)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontWeight: 900, fontSize: isMobile ? 11 : 13, padding: "4px 16px", borderRadius: 20, letterSpacing: "0.05em" }}>
                {team.Conference} · {team.Division}
              </div>
            </div>
          </div>
        </div>

        {/* ===== TABS ===== */}
        <div ref={tabsRef} role="tablist" style={{ scrollMarginTop: 80, display: "flex", gap: isMobile ? 6 : 8, marginBottom: isMobile ? 18 : 24, borderBottom: `3px solid ${tint(c1, "1f")}` }}>
          {/* Phones: four full labels don't fit across one row. */}
          {[["targets", "Targets", "Targets"], ["staff", "Staff", "Staff"], ["depth", "Depth Chart", "Depth"], ["picks", "Projected Picks", "Picks"], ["history", "Draft History", "History"]].map(([key, label, short]) => {
            const active = tab === key;
            return (
              <button
                key={key} role="tab" aria-selected={active}
                onClick={() => setTab(key)}
                style={{
                  flex: isMobile ? 1 : "0 0 auto", marginBottom: -3,
                  padding: isMobile ? "10px 3px" : "11px 20px",
                  background: active ? c1 : "transparent", color: active ? textOn(c1, c2) : c1,
                  border: "none", borderBottom: `3px solid ${active ? c2 : "transparent"}`,
                  borderRadius: "8px 8px 0 0", cursor: "pointer", fontFamily: "inherit",
                  fontWeight: 900, fontSize: isMobile ? 10 : 13, textTransform: "uppercase", letterSpacing: isMobile ? "0.04em" : "0.07em",
                  whiteSpace: "nowrap",
                }}
              >
                {isMobile ? short : label}
              </button>
            );
          })}
        </div>

        {/* ===== DEPTH CHART ===== */}
        {/* ESPN's roster by position group, each group in depth chart order
            — season snaps (nflDepthOrder, see depthRanker in utils/nflRoster.js), never
            shown. */}
        {tab === "depth" && <div style={{ marginBottom: 32 }}>
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

        {/* ===== TARGETS ===== */}
        {tab === "targets" && (
          <div style={{ marginBottom: 32 }}>
            <SectionTitle color1={c1} color2={c2} isMobile={isMobile}>Draft Targets</SectionTitle>
            <ProjectedPicks staff={staff} staffLoading={staffLoading} teamKey={teamKey} color1={c1} color2={c2} isMobile={isMobile} />
          </div>
        )}

        {/* ===== PROJECTED PICKS ===== */}
        {tab === "picks" && (
          <div style={{ marginBottom: 32 }}>
            <SectionTitle color1={c1} color2={c2} isMobile={isMobile}>Projected Picks</SectionTitle>
            <UpcomingPicks team={teamKey} teamName={teamName} color1={c1} color2={c2} isMobile={isMobile} />
          </div>
        )}

        {/* ===== DRAFT HISTORY ===== */}
        {/* Every pick this team has actually made — 2026 (the just-
            completed draft, via draftOrder) plus real history before it
            (via the "historical" collection) — filterable by Year/Round/
            Position the same way TeamPage.js's own college-side "NFL Draft
            History" archive is, just built around one fixed NFL team
            instead of one fixed college. See draftArchive/archiveSchoolLogos
            above for how the two sources are combined. */}
        {tab === "history" && <>
        <SectionTitle color1={c1} color2={c2} isMobile={isMobile}>Draft History</SectionTitle>

        <div style={{ borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2" }}>
          <div style={{ background: c1, padding: "8px 16px" }}>
            <div style={{ color: textOn(c1, c2), fontWeight: 900, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>
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

        {/* Draft targets in words — visible but quiet, at the bottom of the
            Targets tab (same approach as StaffPage.jsx's): names the staff's
            top fits in the next class so searches pairing the team with a
            prospect find the page. Only here — the other tabs aren't about
            prospects. */}
        {tab === "targets" && targets.length > 0 && (
          <section style={{ padding: "28px 6px 4px" }}>
            <h2 style={{ fontSize: 13, fontWeight: 900, color: "#5f6b7a", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px" }}>
              {teamName} {targetsYear} draft targets
            </h2>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#4a5466", lineHeight: 1.65, margin: 0, fontFamily: "Arial, sans-serif" }}>
              Based on the players the {team.Team}&apos; general manager, head coach and coordinators have drafted, the {targetsYear} prospects
              who best fit the {teamName}&apos; draft history are{" "}
              {targets.map((t, i) => (
                <Fragment key={t.sl}>
                  {i > 0 && (i < targets.length - 1 ? ", " : targets.length === 2 ? " and " : ", and ")}
                  <Link to={`/player/${t.sl}`} style={{ color: "#1a1f2b", fontWeight: 800, textDecoration: "underline", textDecorationColor: "#c9d3e0", textUnderlineOffset: 3 }}>{t.F} {t.L}</Link>
                  {` (${[t.S, t.P].filter(Boolean).join(" ")})`}
                </Fragment>
              ))}
              .
            </p>
          </section>
        )}

      </div>
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

    </>
  );
}

// ── Text on one line at the largest size (max → min px) that fits its
// container's width — re-fit whenever the container resizes. ──
function FitText({ children, max, min, style }) {
  const ref = useRef(null);
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      // Measure at max, then scale down by how far it overflows.
      el.style.fontSize = `${max}px`;
      const ratio = el.scrollWidth ? el.clientWidth / el.scrollWidth : 1;
      setSize(Math.max(min, Math.min(max, Math.floor(max * ratio))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement || el);
    return () => ro.disconnect();
  }, [children, max, min]);
  return (
    <div ref={ref} style={{ ...style, fontSize: size, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {children}
    </div>
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
  // First stop that's only playing days — the "Playing Career" divider
  // goes above it.
  const playStart = groups.findIndex((g) => g.stints.every(isPlayerStint));
  // Head coaches and GMs get a /staff/ draft-history page — their name is
  // the (underlined) link to it.
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
              <Link
                to={`/staff/${person.id}`} title={`${person.Name}'s draft history`}
                style={{ color: "inherit", textDecoration: "underline", textDecorationThickness: 2, textUnderlineOffset: 4, textDecorationColor: "rgba(255,255,255,0.7)" }}
              >
                {person.Name}
              </Link>
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
          <div key={gi} style={{ padding: "7px 0", borderTop: gi && gi !== playStart ? "1px solid #eef1f5" : "none" }}>
            {gi === playStart && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 9px" }}>
                <span style={{ fontSize: 9, fontWeight: 900, color: "#fff", background: "#7a8594", borderRadius: 999, padding: "2px 9px", letterSpacing: "0.1em", textTransform: "uppercase" }}>Playing Career</span>
                <span style={{ flex: 1, height: 1, background: "#dfe4ea" }} />
              </div>
            )}
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
                    {isPlayerStint(s) && <span style={{ marginRight: 6, fontSize: 9, fontWeight: 900, color: "#fff", background: "#7a8594", borderRadius: 4, padding: "1px 5px", letterSpacing: "0.06em", fontFamily: "'Arial Black', Arial, sans-serif", verticalAlign: "1px" }}>PLAYER</span>}
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
