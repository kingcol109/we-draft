import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useEffect, useRef, useMemo } from "react";
import ReactDOM from "react-dom";
import {
  doc, getDoc, setDoc, collection, query, where, getDocs, orderBy, serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import Logo1 from "../assets/Logo1.png";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import { useMobileStuckPageWatchdog } from "../hooks/useMobileStuckPageWatchdog";
import { useAuth } from "../context/AuthContext";
import { getAnonId } from "../utils/anonId";

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

// ── Team Needs vote — the nine positions visitors rate, and the 1-5 need
// scale each gets rated on. Mirrors firestore.rules' teamNeeds/{team}/
// votes/{uid} field list/range exactly (see isValidNeedRating there). ──
const NEED_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "DB"];
const NEED_LEVELS = [
  { v: 1, label: "None" },
  { v: 2, label: "Low" },
  { v: 3, label: "Med" },
  { v: 4, label: "High" },
  { v: 5, label: "Extreme" },
];

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

// Stat labels by position group
function getStatLabels(pos) {
  const p = pos?.toUpperCase();
  if (p === "QB") return { passYds: "Pass Yds", passTDs: "Pass TDs", ints: "INTs", compPct: "Comp%" };
  if (["RB", "FB"].includes(p)) return { rushYds: "Rush Yds", rushTDs: "Rush TDs", rec: "Rec", recYds: "Rec Yds" };
  if (["WR", "TE"].includes(p)) return { rec: "Rec", recYds: "Rec Yds", recTDs: "Rec TDs", targets: "Targets" };
  if (["K"].includes(p)) return { fgMade: "FG Made", fgAtt: "FG Att", xpMade: "XP Made", longFG: "Long FG" };
  if (["P"].includes(p)) return { punts: "Punts", puntAvg: "Avg", inside20: "In 20", touchbacks: "TBs" };
  // Default: defensive
  return { tackles: "Tackles", sacks: "Sacks", tfl: "TFL", ints: "INTs" };
}

function parseStats(statsData, pos) {
  // statisticslog returns { splits: { categories: [...] } } or categories directly
  const cats = statsData?.splits?.categories || statsData?.categories || [];
  if (!cats.length) return null;

  const find = (catName, statName) => {
    const cat = cats.find((c) => c.name === catName || c.displayName === catName);
    if (!cat) return null;
    const stat = cat.stats?.find((s) => s.name === statName || s.abbreviation === statName);
    return stat?.value != null ? (Number.isInteger(stat.value) ? stat.value : parseFloat(stat.value).toFixed(1)) : null;
  };

  const p = pos?.toUpperCase();
  if (p === "QB") return {
    passYds: find("passing", "passingYards"),
    passTDs: find("passing", "passingTouchdowns"),
    ints: find("passing", "interceptions"),
    compPct: find("passing", "completionPct"),
  };
  if (["RB", "FB"].includes(p)) return {
    rushYds: find("rushing", "rushingYards"),
    rushTDs: find("rushing", "rushingTouchdowns"),
    rec: find("receiving", "receptions"),
    recYds: find("receiving", "receivingYards"),
  };
  if (["WR", "TE"].includes(p)) return {
    rec: find("receiving", "receptions"),
    recYds: find("receiving", "receivingYards"),
    recTDs: find("receiving", "receivingTouchdowns"),
    targets: find("receiving", "receivingTargets"),
  };
  if (p === "K") return {
    fgMade: find("kicking", "FGM"),
    fgAtt: find("kicking", "FGA"),
    xpMade: find("kicking", "EPM"),
    longFG: find("kicking", "longFieldGoal"),
  };
  if (p === "P") return {
    punts: find("punting", "punts"),
    puntAvg: find("punting", "grossAvgPuntYards"),
    inside20: find("punting", "puntInside20"),
    touchbacks: find("punting", "puntTouchbacks"),
  };
  return {
    tackles: find("defensive", "totalTackles"),
    sacks: find("defensive", "sacks"),
    tfl: find("defensive", "tacklesForLoss"),
    ints: find("defensive", "interceptions"),
  };
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
`;

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

export default function NFLTeamPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const teamKey = teamId?.toUpperCase();
  const { user } = useAuth();

  const [team, setTeam] = useState(null);
  const [picks, setPicks] = useState([]);
  const [playersBySlug, setPlayersBySlug] = useState({});
  // Pre-2026 real draft history for this team — see the "historical"
  // collection AdminPanel.js's Player Data → Historical tab manages
  // (same source TeamPage.js's own college-side archive reads), filtered
  // here by "NFL Team" (a full "City Team" name string, not the
  // abbreviation this page's own teamKey is) instead of by School.
  const [historicalPicks, setHistoricalPicks] = useState([]);
  // College logos for the Draft Archive rows below — batched "in" query
  // against schools/{name}, same Logo1-on-white-background preference
  // PlayerProfile.js's own class-list rows use (see that file's own
  // comment on why Logo1 specifically, not LogoDark-first).
  const [archiveSchoolLogos, setArchiveSchoolLogos] = useState({});
  // "Team Needs" vote — see NEED_POSITIONS/NEED_LEVELS above and
  // firestore.rules' teamNeeds/{team}/votes/{uid}. needVotes is every
  // voter's doc (aggregated into a per-position average below);
  // myNeedVote is just this visitor's own ratings, keyed by position, so
  // their current picks stay highlighted and can be changed anytime.
  const [needVotes, setNeedVotes] = useState([]);
  const [myNeedVote, setMyNeedVote] = useState({});
  const [needsLoading, setNeedsLoading] = useState(true);
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
  const [rosterLoading, setRosterLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState(null);
  const [statsCache, setStatsCache] = useState({});
  const [statsLoading, setStatsLoading] = useState({});
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  // Mobile "stuck loading forever" watchdog — see the hook's own comment.
  useMobileStuckPageWatchdog(!team && loading, teamKey, { enabled: isMobile });
  const [seoDataReady, setSeoDataReady] = useState(false);
  const hoverTimeout = useRef(null);
  const picksRef = useRef(null);

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

  // Load Team Needs votes — whole subcollection (aggregated client-side
  // into needAverages below, same "read it all, compute totals in the
  // browser" pattern PlayerProfile.js's own reactions/evaluations use).
  // Refetches on `user` too so logging in/out re-resolves which doc (real
  // uid vs anon id) counts as "mine".
  useEffect(() => {
    if (!teamKey) return;
    setNeedsLoading(true);
    (async () => {
      try {
        const snap = await getDocs(collection(db, "teamNeeds", teamKey, "votes"));
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setNeedVotes(docs);
        const myId = user ? user.uid : getAnonId();
        const mine = docs.find((d) => d.id === myId);
        setMyNeedVote(mine || {});
      } catch (e) {
        console.error("Team needs fetch error:", e);
        setNeedVotes([]);
        setMyNeedVote({});
      } finally {
        setNeedsLoading(false);
      }
    })();
  }, [teamKey, user]);

  // Rate (or re-rate) one position — optimistic local update of both the
  // visitor's own picks and the aggregate array, then a merge write so
  // only this one field changes on their doc (leaving any other
  // positions they've already rated untouched).
  const handleRateNeed = (position, value) => {
    if (!teamKey) return;
    const myId = user ? user.uid : getAnonId();
    setMyNeedVote((prev) => ({ ...prev, [position]: value }));
    setNeedVotes((prev) => {
      const idx = prev.findIndex((v) => v.id === myId);
      if (idx === -1) return [...prev, { id: myId, [position]: value }];
      const next = [...prev];
      next[idx] = { ...next[idx], [position]: value };
      return next;
    });
    setDoc(doc(db, "teamNeeds", teamKey, "votes", myId), {
      uid: myId, [position]: value, updatedAt: serverTimestamp(),
    }, { merge: true }).catch((e) => console.error("Team needs vote error:", e));
  };

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
        console.error("Team needs board popup fetch error:", e);
        if (!cancelled) setBoardModalPlayers([]);
      } finally {
        if (!cancelled) setBoardModalLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [boardModal]);

  // Load ESPN roster
  useEffect(() => {
    if (!teamKey) return;
    const espnId = ESPN_TEAM_IDS[teamKey];
    if (!espnId) { setRosterLoading(false); return; }

    const fetchRoster = async () => {
      try {
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnId}/roster`);
        const data = await res.json();
        // ESPN returns athletes grouped by position groups
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

  // College logos for the rows above — batched "in" query, same chunked
  // pattern used elsewhere (e.g. PlayerProfile.js's class-list rows),
  // fetched only for schools not already cached. archiveSchoolLogosRef
  // mirrors the state so this can check "already have or already tried"
  // without listing archiveSchoolLogos itself as a dependency — same
  // reasoning as WatchButton's own schoolLogoRef in PlayerProfile.js
  // (depending on the state directly would re-run this effect right after
  // its own setState, if only to find nothing left to fetch).
  const archiveSchoolLogosRef = useRef({});
  useEffect(() => { archiveSchoolLogosRef.current = archiveSchoolLogos; }, [archiveSchoolLogos]);
  useEffect(() => {
    const schoolNames = [...new Set(draftArchive.map((e) => e.school).filter(Boolean))]
      .filter((s) => !(s in archiveSchoolLogosRef.current));
    if (schoolNames.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const chunks = [];
        for (let i = 0; i < schoolNames.length; i += 10) chunks.push(schoolNames.slice(i, i + 10));
        const snaps = await Promise.all(
          chunks.map((chunk) => getDocs(query(collection(db, "schools"), where("School", "in", chunk))))
        );
        const found = {};
        snaps.forEach((snap) => snap.docs.forEach((d) => {
          const data = d.data();
          if (data.School) found[data.School] = data.Logo1 || "";
        }));
        schoolNames.forEach((s) => { if (!(s in found)) found[s] = ""; }); // no match — cache empty, don't retry
        if (!cancelled) setArchiveSchoolLogos((prev) => ({ ...prev, ...found }));
      } catch (e) {
        console.error("Draft archive school logo fetch error:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [draftArchive]);

  // Fetch stats for a player on hover — only show 2025 season stats
  const fetchStats = async (athleteId) => {
    if (statsCache[athleteId] !== undefined || statsLoading[athleteId]) return;
    setStatsLoading((prev) => ({ ...prev, [athleteId]: true }));
    try {
      const res = await fetch(
        `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/${athleteId}/statisticslog`
      );
      const data = await res.json();
      const entries = data?.entries || [];

      // Only use a 2025 regular season entry — never fall back to 2024
      const entry2025 = entries.find((e) => {
        const seasonRef = e?.season?.$ref || e?.seasonType?.$ref || "";
        const year = e?.season?.year || e?.year;
        const typeName = e?.type?.name || e?.seasonType?.name || "";
        return (
          (year === 2025 || seasonRef.includes("/2025/")) &&
          (typeName.toLowerCase().includes("regular") || typeName === "" || typeName.toLowerCase().includes("season"))
        );
      });

      if (entry2025?.statistics) {
        // statistics may itself be a $ref — follow it if so
        if (entry2025.statistics.$ref) {
          const res2 = await fetch(entry2025.statistics.$ref);
          const data2 = await res2.json();
          setStatsCache((prev) => ({ ...prev, [athleteId]: data2 }));
        } else {
          setStatsCache((prev) => ({ ...prev, [athleteId]: entry2025.statistics }));
        }
      } else {
        // No 2025 entry — store null so tooltip shows no stats
        setStatsCache((prev) => ({ ...prev, [athleteId]: null }));
      }
    } catch {
      setStatsCache((prev) => ({ ...prev, [athleteId]: null }));
    } finally {
      setStatsLoading((prev) => ({ ...prev, [athleteId]: false }));
    }
  };

  const handleMouseEnter = (athleteId) => {
    hoverTimeout.current = setTimeout(() => {
      setHoveredId(athleteId);
      fetchStats(athleteId);
    }, 200);
  };

  const handleMouseLeave = () => {
    clearTimeout(hoverTimeout.current);
    setHoveredId(null);
  };

  // Group roster by position group
  const groupedRoster = {};
  const allGroupedPositions = new Set(Object.values(POSITION_GROUPS).flat());
  Object.entries(POSITION_GROUPS).forEach(([group, positions]) => {
    const members = roster.filter((p) => positions.includes(p.position));
    if (members.length > 0) groupedRoster[group] = members;
  });
  const ungrouped = roster.filter((p) => !allGroupedPositions.has(p.position));
  if (ungrouped.length > 0) groupedRoster["Other"] = ungrouped;

  // Blocks first paint only until the team doc itself resolves (the single
  // getDoc at the top of the load effect) — not the draft-picks query and
  // per-pick player lookups behind it, which the Draft Picks section below
  // gates on its own instead. Still falls back to this full-page spinner if
  // that first fetch fails outright (loading flips false via the effect's
  // own early return without team ever getting set), so a bad teamId still
  // correctly reaches "Team not found" below instead of spinning forever.
  if (!team && loading) return <LoadingSpinner label="Loading" size={56} minHeight="60vh" />;

  if (!team) return (
    <div style={{ textAlign: "center", marginTop: 80, color: "red", fontWeight: 900 }}>Team not found</div>
  );

  const c1 = team.Color1 || BLUE;
  const c2 = team.Color2 || GOLD;
  const teamName = `${team.City} ${team.Team}`.trim();
  const metaDescription = `${teamName} NFL Draft Hub — mock drafts, player grades, and draft archives for the ${teamName}.`;
  const pageUrl = `https://we-draft.com/nfl/${teamId}`;
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

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 24px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

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
              onClick={() => picksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
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

        {/* ===== TEAM NEEDS ===== */}
        {/* Open to every visitor, account or not (see handleRateNeed/
            useEffect above) — a rating auto-saves the moment it's clicked,
            no separate submit step, and can be changed anytime by just
            clicking a different level. Magnitude (the community average)
            is shown as a bar sized by length plus its own numeric label —
            not color alone — so it reads correctly even for a color-blind
            viewer or in a screen reader. */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: c1, marginBottom: 5 }}>
              Team Needs
            </div>
            <div style={{ height: 3, background: c1, borderRadius: 2, marginBottom: 3 }} />
            <div style={{ height: 3, background: c2, borderRadius: 2 }} />
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 12, lineHeight: 1.5 }}>
            Rate how badly this team needs to address each position, from No Need to Extreme Need. Come back and change your vote anytime.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 10 }}>
            {NEED_POSITIONS.map((pos) => {
              const ratings = needVotes.map((v) => v[pos]).filter((v) => typeof v === "number");
              const avg = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
              const pct = (avg / 5) * 100;
              const myRating = myNeedVote[pos];

              return (
                <div key={pos} style={{ border: `2px solid ${c1}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px" }}>
                    <span style={{ fontWeight: 900, fontSize: 13, color: c1, letterSpacing: "0.04em" }}>{pos}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#999" }}>
                      {ratings.length > 0 ? `${avg.toFixed(1)}/5 · ${ratings.length} vote${ratings.length !== 1 ? "s" : ""}` : "No votes yet"}
                    </span>
                  </div>
                  <div style={{ height: 5, background: "#eee", position: "relative" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: c1, transition: "width 0.2s" }} />
                  </div>
                  <div style={{ display: "flex", gap: 4, padding: "8px 10px" }}>
                    {NEED_LEVELS.map(({ v, label }) => {
                      const active = myRating === v;
                      return (
                        <button
                          key={v}
                          onClick={() => handleRateNeed(pos, v)}
                          disabled={needsLoading}
                          title={label}
                          style={{
                            flex: 1, border: `2px solid ${c1}`, borderRadius: 6,
                            padding: isMobile ? "6px 2px" : "6px 4px",
                            background: active ? c1 : "#fff",
                            color: active ? "#fff" : c1,
                            fontWeight: 900, fontSize: isMobile ? 9 : 10,
                            cursor: needsLoading ? "default" : "pointer",
                            textTransform: "uppercase", letterSpacing: "0.02em",
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ===== ROSTER ===== */}
        <div style={{ marginBottom: 32 }}>
          {/* Section title */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: c1, marginBottom: 5 }}>
              2026 Roster
            </div>
            <div style={{ height: 3, background: c1, borderRadius: 2, marginBottom: 3 }} />
            <div style={{ height: 3, background: c2, borderRadius: 2 }} />
          </div>

          {rosterLoading ? (
            <LoadingSpinner label="Loading roster" size={28} minHeight="140px" />
          ) : roster.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: 14 }}>Roster unavailable.</div>
          ) : (
            Object.entries(groupedRoster).map(([group, players]) => (
              <div key={group} style={{ marginBottom: 24 }}>
                {/* Position group header with count */}
                <div style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: c1, borderBottom: `2px solid ${c1}`, paddingBottom: 4, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>{group}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: 0 }}>{players.length}</span>
                </div>

                {/* Player grid */}
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(6, 1fr)", gap: 8 }}>
                  {players.map((player) => {
                    const isHovered = hoveredId === player.id;
                    const expStr = player.experience === 0 ? "Rookie" : player.experience === 1 ? "1st yr" : player.experience != null ? `${player.experience} yrs` : null;
                    const weightClean = player.weight ? player.weight.toString().replace(/\s*lbs\.?/i, "").trim() : null;

                    return (
                      <div
                        key={player.id}
                        onMouseEnter={() => handleMouseEnter(player.id)}
                        onMouseLeave={handleMouseLeave}
                        style={{ position: "relative", background: "#fff", border: `2px solid ${c1}`, borderRadius: 8, overflow: "visible", cursor: "default" }}
                      >
                        {/* Top bar */}
                        <div style={{ background: c1, padding: "4px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: "6px 6px 0 0" }}>
                          <span style={{ fontSize: 9, fontWeight: 900, color: "#fff", letterSpacing: "0.06em" }}>{player.position}</span>
                          {player.jersey && <span style={{ fontSize: 9, fontWeight: 900, color: "rgba(255,255,255,0.8)" }}>#{player.jersey}</span>}
                        </div>

                        {/* Name — no headshot/logo art, just the name as the
                            card's own content, given more breathing room
                            than it had as a caption under a photo. */}
                        <div style={{ padding: isMobile ? "12px 6px" : "16px 8px", textAlign: "center" }}>
                          <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 900, color: c1, lineHeight: 1.25, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                            {player.firstName}
                          </div>
                          <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: 900, color: c1, lineHeight: 1.25, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                            {player.lastName}
                          </div>
                          {expStr && (
                            <div style={{ fontSize: 9, fontWeight: 700, color: "#aaa", marginTop: 4 }}>{expStr}</div>
                          )}
                        </div>

                        {/* Hover tooltip — team colored */}
                        {isHovered && (
                          <div style={{
                            position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
                            background: c1, borderRadius: 8, overflow: "hidden",
                            width: 190, zIndex: 100,
                            boxShadow: `0 6px 20px rgba(0,0,0,0.3)`,
                            border: `2px solid ${c2}`,
                            pointerEvents: "none",
                          }}>
                            {/* Header bar */}
                            <div style={{ background: c2, padding: "5px 10px" }}>
                              <div style={{ fontWeight: 900, fontSize: 12, color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.2 }}>
                                {player.fullName}
                              </div>
                            </div>
                            {/* Bio */}
                            <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
                              {[
                                player.position ? { label: "POS", value: player.position } : null,
                                player.age ? { label: "AGE", value: player.age } : null,
                                player.height ? { label: "HT", value: player.height } : null,
                                weightClean ? { label: "WT", value: `${weightClean} lbs` } : null,
                                player.college ? { label: "COLLEGE", value: player.college } : null,
                              ].filter(Boolean).map(({ label, value }) => (
                                <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                                  <span style={{ fontSize: 8, fontWeight: 900, color: c2, textTransform: "uppercase", letterSpacing: "0.1em", flexShrink: 0, minWidth: 40 }}>{label}</span>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>{value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* "+" tile — same grid cell as every player above it, so
                      it stretches to match their height for free (grid's
                      default align-items:stretch). Pops up that group's
                      2027 board right here instead of navigating away (see
                      boardModal above) — omitted for a group with no board
                      equivalent. */}
                  {ROSTER_GROUP_TO_BOARD_POSITIONS[group] && (
                    <button
                      onClick={() => setBoardModal({ positions: ROSTER_GROUP_TO_BOARD_POSITIONS[group], label: ROSTER_GROUP_TO_BOARD_POSITIONS[group].join(" / ") })}
                      title={`See the 2027 ${ROSTER_GROUP_TO_BOARD_POSITIONS[group].join(" / ")} board`}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        height: "100%", minHeight: isMobile ? 70 : 86,
                        background: c1, border: `2px solid ${c1}`, borderRadius: 8,
                        color: "#fff", cursor: "pointer", boxSizing: "border-box",
                      }}
                    >
                      <span style={{ fontSize: isMobile ? 38 : 46, fontWeight: 900, lineHeight: 1 }}>+</span>
                      <span style={{ fontSize: isMobile ? 10 : 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 4, textAlign: "center" }}>
                        2027 Board
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ===== DRAFT ARCHIVE ===== */}
        {/* Every pick this team has actually made — 2026 (the just-
            completed draft, via draftOrder) plus real history before it
            (via the "historical" collection) — filterable by Year/Round/
            Position the same way TeamPage.js's own college-side "NFL Draft
            History" archive is, just built around one fixed NFL team
            instead of one fixed college. See draftArchive/archiveSchoolLogos
            above for how the two sources are combined. */}
        <div ref={picksRef} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: c1, marginBottom: 5 }}>
            Draft Archive
          </div>
          <div style={{ height: 3, background: c1, borderRadius: 2, marginBottom: 3 }} />
          <div style={{ height: 3, background: c2, borderRadius: 2 }} />
        </div>

        <div style={{ border: `2px solid ${c1}`, borderRadius: 10, overflow: "hidden" }}>
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
              navigate={navigate} isMobile={isMobile} color1={c1} color2={c2}
            />
          )}
        </div>

      </div>

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
              height: isMobile ? "80vh" : 640,
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

// ── Draft Archive filter bar + rows — same Year/Round/Position
// multi-select shape as TeamPage.js's own ArchiveFilters, adapted here
// since that component isn't exported and this page's rows are shaped
// differently (a college logo per row, since the NFL team is fixed here
// rather than the college). ──
function DraftArchiveList({ archive, schoolLogos, navigate, isMobile, color1, color2 }) {
  const [selectedYears, setSelectedYears] = useState(new Set());
  const [selectedRounds, setSelectedRounds] = useState(new Set());
  const [selectedPositions, setSelectedPositions] = useState(new Set());
  const [openPanel, setOpenPanel] = useState(null);

  const toggle = (setFn, val) => setFn((prev) => {
    const next = new Set(prev);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  });
  const clearAll = () => { setSelectedYears(new Set()); setSelectedRounds(new Set()); setSelectedPositions(new Set()); setOpenPanel(null); };
  const hasFilters = selectedYears.size > 0 || selectedRounds.size > 0 || selectedPositions.size > 0;

  const allYears = [...new Set(archive.map((e) => e.year))].sort((a, b) => b - a);
  const allRounds = [...new Set(archive.map((e) => e.round).filter(Boolean))].sort((a, b) => a - b);
  const POS_ORDER = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB", "K", "P", "LS"];
  const allPositions = [...new Set(archive.map((e) => e.position).filter(Boolean))].sort((a, b) => {
    const ai = POS_ORDER.indexOf(a), bi = POS_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const filtered = archive.filter((e) => {
    if (selectedYears.size > 0 && !selectedYears.has(e.year)) return false;
    if (selectedRounds.size > 0 && !selectedRounds.has(e.round)) return false;
    if (selectedPositions.size > 0 && !selectedPositions.has(e.position)) return false;
    return true;
  });

  if (archive.length === 0) {
    return <div style={{ padding: 32, textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: 14, background: "#fff" }}>No picks on record</div>;
  }

  return (
    <>
      {openPanel && (
        <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setOpenPanel(null)} onTouchStart={() => setOpenPanel(null)} />
      )}

      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: isMobile ? "10px 12px" : "10px 18px",
        background: "#f7f8fa", borderBottom: "1px solid #e8e8e8",
        position: "relative", zIndex: 100,
      }}>
        <span style={{ fontSize: 11, fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>Filter:</span>
        <ArchiveFilterButton label="Year" options={allYears} panelKey="year" activeSet={selectedYears}
          onToggle={(v) => toggle(setSelectedYears, v)} onClearGroup={() => setSelectedYears(new Set())}
          color1={color1} color2={color2} openPanel={openPanel} setOpenPanel={setOpenPanel} />
        <ArchiveFilterButton label="Round" options={allRounds} panelKey="round" activeSet={selectedRounds}
          onToggle={(v) => toggle(setSelectedRounds, v)} onClearGroup={() => setSelectedRounds(new Set())}
          color1={color1} color2={color2} openPanel={openPanel} setOpenPanel={setOpenPanel} />
        <ArchiveFilterButton label="Position" options={allPositions} panelKey="pos" activeSet={selectedPositions}
          onToggle={(v) => toggle(setSelectedPositions, v)} onClearGroup={() => setSelectedPositions(new Set())}
          color1={color1} color2={color2} openPanel={openPanel} setOpenPanel={setOpenPanel} />
        {hasFilters && (
          <button onClick={clearAll} style={{ border: "2px solid #ccc", borderRadius: 6, padding: "5px 12px", fontWeight: 900, fontSize: 11, color: "#888", background: "#fff", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Clear All
          </button>
        )}
        <span style={{ marginLeft: isMobile ? 0 : "auto", width: isMobile ? "100%" : "auto", fontSize: 11, fontWeight: 700, color: "#aaa" }}>
          {filtered.length} pick{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: "40px 24px", textAlign: "center", background: "#fff" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: color1, textTransform: "uppercase", letterSpacing: "0.06em" }}>No results</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#888", marginTop: 6 }}>Try adjusting your filters.</div>
        </div>
      ) : (
        filtered.map((entry) => {
          const logo = schoolLogos[entry.school];
          return (
            <div
              key={entry.key}
              onClick={() => entry.slug && navigate(`/player/${entry.slug}`)}
              style={{
                display: "flex", alignItems: "center", gap: isMobile ? 10 : 14,
                padding: isMobile ? "10px 12px" : "12px 16px",
                borderBottom: "1px solid #f0f0f0",
                background: "#fff", cursor: entry.slug ? "pointer" : "default",
              }}
              onMouseEnter={(e) => { if (entry.slug) e.currentTarget.style.background = "#f0f5ff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              <div style={{ flexShrink: 0, width: isMobile ? 34 : 40, textAlign: "center" }}>
                <span style={{ fontSize: isMobile ? 13 : 15, fontWeight: 900, color: "#444" }}>{entry.year}</span>
              </div>

              <div style={{
                flexShrink: 0, width: isMobile ? 46 : 56, height: isMobile ? 46 : 56,
                borderRadius: 8, background: color1, border: `2px solid ${color2}`,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff",
              }}>
                <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 900, lineHeight: 1 }}>{entry.pick !== 9999 ? entry.pick : "—"}</div>
                <div style={{ fontSize: 8, fontWeight: 800, opacity: 0.7, textTransform: "uppercase" }}>Rd {entry.round || "—"}</div>
              </div>

              {!isMobile && (
                <div style={{ flexShrink: 0, width: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {logo ? (
                    <div style={{ width: 32, height: 32, background: "#f5f5f5", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                      <img src={sanitizeUrl(logo)} alt={entry.school} loading="lazy" style={{ width: 28, height: 28, objectFit: "contain" }} onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }} />
                    </div>
                  ) : <div style={{ width: 32 }} />}
                </div>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 900, color: color1, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {entry.playerName || "—"}
                </div>
                <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 700, color: "#555", marginTop: 2 }}>
                  {[entry.position, entry.school].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>

              {entry.slug && <div style={{ flexShrink: 0, fontSize: 18, color: color2, fontWeight: 900 }}>→</div>}
            </div>
          );
        })
      )}
    </>
  );
}

// ── Filter dropdown — renders via portal to escape overflow:hidden
// ancestors, same mechanics as TeamPage.js's own FilterButton. ──
function ArchiveFilterButton({ label, options, panelKey, activeSet, onToggle, onClearGroup, color1, color2, openPanel, setOpenPanel }) {
  const isOpen = openPanel === panelKey;
  const hasActive = activeSet.size > 0;
  const btnRef = useRef(null);
  const [dropdownStyle, setDropdownStyle] = useState({});

  useEffect(() => {
    if (isOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: "fixed", top: rect.bottom + 6, left: rect.left, zIndex: 99999,
        background: "#fff", border: `2px solid ${color1}`, borderRadius: 8,
        boxShadow: "0 4px 20px rgba(0,0,0,0.18)", minWidth: 160, overflow: "hidden",
      });
    }
  }, [isOpen, color1]);

  const dropdown = isOpen ? ReactDOM.createPortal(
    <div style={dropdownStyle}>
      <div style={{ background: color1, padding: "6px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
        {activeSet.size > 0 && (
          <button onClick={(e) => { e.stopPropagation(); onClearGroup(); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: 10, cursor: "pointer", fontWeight: 700 }}>Clear</button>
        )}
      </div>
      <div style={{ height: 2, background: color2 }} />
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {options.map((val) => {
          const checked = activeSet.has(val);
          return (
            <label key={val} onClick={() => onToggle(val)} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer",
              borderBottom: "1px solid #f0f0f0", background: checked ? `${color1}0d` : "#fff", transition: "background 0.1s",
            }}>
              <div style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0, border: `2px solid ${checked ? color1 : "#ccc"}`, background: checked ? color1 : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {checked && <span style={{ color: "#fff", fontSize: 10, fontWeight: 900, lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#333", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {panelKey === "round" ? `Round ${val}` : val}
              </span>
            </label>
          );
        })}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={() => setOpenPanel(isOpen ? null : panelKey)}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          border: `2px solid ${hasActive ? color1 : "#d0d0d0"}`, borderRadius: 6, padding: "5px 10px",
          fontWeight: 900, fontSize: 11, color: hasActive ? color1 : "#666",
          background: hasActive ? `${color1}10` : "#fff", cursor: "pointer",
          textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
        }}
      >
        {label}
        {hasActive && (
          <span style={{ background: color1, color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 900 }}>{activeSet.size}</span>
        )}
        <span style={{ fontSize: 8, color: "#aaa", marginLeft: 2 }}>{isOpen ? "▲" : "▼"}</span>
      </button>
      {dropdown}
    </div>
  );
}