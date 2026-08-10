import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import {
  doc, getDoc, collection, query, where, getDocs, orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import Logo1 from "../assets/Logo1.png";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

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

  const [team, setTeam] = useState(null);
  const [picks, setPicks] = useState([]);
  const [playersBySlug, setPlayersBySlug] = useState({});
  const [roster, setRoster] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState(null);
  const [statsCache, setStatsCache] = useState({});
  const [statsLoading, setStatsLoading] = useState({});
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
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
        setTeam(teamSnap.data());

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
        setLoading(false);
      } finally {
        setSeoDataReady(true);
      }
    };
    loadData();
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
  // Oversized and faded — no logo fallback, since a wordmark is what's
  // meant to read as a soft background graphic; without one, the hero
  // just has no watermark. No separate foreground wordmark image either —
  // City/Team are always shown as text, stacked as two bold lines.
  const watermarkWordmark = team.WordmarkDark || team.Wordmark || "";

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
        {/* Built on the same recipe as GamePage.js's matchup hero (see
            HERO_STYLE above) instead of the old flat white card: a
            color1→color2 blend, a drifting stripe texture + breathing
            spotlight, a plain (no badge/ring) logo, and a giant faded
            wordmark bleeding off the edge for depth. */}
        <div style={{
          position: "relative", overflow: "hidden", borderRadius: 12,
          border: `3px solid ${c2}`, marginBottom: 24,
          boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
          background: [
            "linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4))",
            `linear-gradient(120deg, ${c1} 0%, ${c1} 40%, ${c2} 100%)`,
          ].join(", "),
          padding: isMobile ? "22px 16px" : "34px 32px",
        }}>
          <div aria-hidden="true" style={{
            position: "absolute", inset: "-20%", zIndex: 0, pointerEvents: "none",
            background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 2px, transparent 2px, transparent 40px)",
            animation: "wdNflHeroDrift 18s linear infinite",
          }} />
          <div aria-hidden="true" style={{
            position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
            background: "radial-gradient(circle at 50% 22%, rgba(255,255,255,0.18), transparent 55%)",
            animation: "wdNflHeroSpotlight 5s ease-in-out infinite",
          }} />
          {watermarkWordmark && !isMobile && (
            <img
              src={sanitizeUrl(watermarkWordmark)} alt="" aria-hidden="true"
              style={{
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                width: "75%", maxWidth: "680px", height: "auto", objectFit: "contain",
                opacity: 0.13, zIndex: 0, pointerEvents: "none",
              }}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          )}

          <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            {heroLogo && (
              <img src={sanitizeUrl(heroLogo)} alt={team.Team}
                style={{ width: isMobile ? 100 : 170, height: isMobile ? 100 : 170, objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.45))", marginBottom: 14 }}
                onError={(e) => { e.currentTarget.style.display = "none"; }} />
            )}
            <div style={{ fontSize: isMobile ? "clamp(18px, 6vw, 26px)" : "clamp(28px, 3.4vw, 44px)", fontWeight: 900, color: "rgba(255,255,255,0.88)", lineHeight: 1.05, letterSpacing: "0.02em", textTransform: "uppercase", textShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
              {team.City}
            </div>
            <div style={{ fontSize: isMobile ? "clamp(28px, 8vw, 44px)" : "clamp(44px, 6vw, 72px)", fontWeight: 900, color: "#fff", lineHeight: 1.05, letterSpacing: "0.02em", textTransform: "uppercase", textShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
              {team.Team}
            </div>
            <div style={{ marginTop: 10, display: "inline-block", background: "rgba(0,0,0,0.32)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontWeight: 900, fontSize: isMobile ? 11 : 13, padding: "4px 16px", borderRadius: 20, letterSpacing: "0.05em" }}>
              {team.Conference} · {team.Division}
            </div>
            {/* Draft picks scroll button */}
            <div style={{ marginTop: 14 }}>
              <button
                onClick={() => picksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                style={{
                  background: "rgba(255,255,255,0.95)", border: "2px solid #fff", color: c1,
                  borderRadius: 8, padding: "8px 20px", fontWeight: 900,
                  fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em",
                  cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
                }}
              >
                2026 Draft Picks ↓
              </button>
            </div>
          </div>
        </div>

        {/* ===== STAFF ===== */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
          <StaffCard color={c1} label="Head Coach" value={team.HeadCoach} />
          <StaffCard color={c1} label="General Manager" value={team.GeneralManager} />
          <StaffCard color={c1} label="Off. Coordinator" value={team.OffensiveCoordinator} scheme={team.OffensiveScheme} />
          <StaffCard color={c1} label="Def. Coordinator" value={team.DefensiveCoordinator} scheme={team.DefensiveScheme} />
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
                    const imgSrc = player.headshot || sanitizeUrl(team.Logo1);
                    const isLogo = !player.headshot;

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

                        {/* Headshot or team logo fallback */}
                        <div style={{ background: "#fff", height: isMobile ? 64 : 80, display: "flex", alignItems: isLogo ? "center" : "flex-end", justifyContent: "center", overflow: "hidden", padding: isLogo ? "10px" : 0 }}>
                          <img
                            src={imgSrc}
                            alt={player.fullName}
                            loading="lazy"
                            style={{ height: isLogo ? "70%" : "100%", objectFit: "contain", objectPosition: isLogo ? "center" : "top", opacity: isLogo ? 0.35 : 1 }}
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                          />
                        </div>

                        {/* Name */}
                        <div style={{ padding: "6px 6px 8px", textAlign: "center" }}>
                          <div style={{ fontSize: isMobile ? 10 : 11, fontWeight: 900, color: c1, lineHeight: 1.2, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                            {player.firstName}
                          </div>
                          <div style={{ fontSize: isMobile ? 11 : 12, fontWeight: 900, color: c1, lineHeight: 1.2, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                            {player.lastName}
                          </div>
                          {expStr && (
                            <div style={{ fontSize: 9, fontWeight: 700, color: "#aaa", marginTop: 2 }}>{expStr}</div>
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
                </div>
              </div>
            ))
          )}
        </div>

        {/* ===== DRAFT PICKS ===== */}
        <div ref={picksRef} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: c1, marginBottom: 5 }}>
            2026 Draft Picks
          </div>
          <div style={{ height: 3, background: c1, borderRadius: 2, marginBottom: 3 }} />
          <div style={{ height: 3, background: c2, borderRadius: 2 }} />
        </div>

        <div style={{ border: `2px solid ${c1}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ background: c1, padding: "8px 16px" }}>
            <div style={{ color: c2, fontWeight: 900, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {loading ? "Loading…" : `${picks.length} Pick${picks.length !== 1 ? "s" : ""}`}
            </div>
          </div>
          <div style={{ height: 3, background: c2 }} />

          {loading ? (
            <div style={{ padding: 32, background: "#fff" }}>
              <LoadingSpinner label="Loading picks" size={24} minHeight="80px" />
            </div>
          ) : picks.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: 14, background: "#fff" }}>No picks</div>
          ) : (
            picks.map((p, i) => {
              const player = playersBySlug[p.Selection];
              return (
                <div key={i}
                  onClick={() => player && navigate(`/player/${player.Slug}`)}
                  style={{
                    display: "flex", alignItems: "center", gap: isMobile ? 10 : 14,
                    padding: isMobile ? "10px 12px" : "12px 16px",
                    borderBottom: i < picks.length - 1 ? "1px solid #f0f0f0" : "none",
                    background: "#fff", cursor: player ? "pointer" : "default",
                  }}
                  onMouseEnter={(e) => { if (player) e.currentTarget.style.background = "#f0f5ff"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                >
                  <div style={{
                    flexShrink: 0, width: isMobile ? 46 : 56, height: isMobile ? 46 : 56,
                    borderRadius: 8, background: c1, border: `2px solid ${c2}`,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff",
                  }}>
                    <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 900, lineHeight: 1 }}>{p.Pick}</div>
                    <div style={{ fontSize: 8, fontWeight: 800, opacity: 0.7, textTransform: "uppercase" }}>Rd {p.Round}</div>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {player ? (
                      <>
                        <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 900, color: c1, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          {player.First} {player.Last}
                        </div>
                        <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 700, color: "#555", marginTop: 2 }}>
                          {player.Position} · {player.School}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: 700, color: "#bbb", fontStyle: "italic" }}>Pick not yet made</div>
                    )}
                  </div>

                  {player && <div style={{ flexShrink: 0, fontSize: 18, color: c2, fontWeight: 900 }}>→</div>}
                </div>
              );
            })
          )}
        </div>

      </div>
    </>
  );
}

function StaffCard({ label, value, scheme, color }) {
  return (
    <div style={{ border: `2px solid ${color}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
      <div style={{ background: color, color: "#fff", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", padding: "5px 10px" }}>
        {label}
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: "#111" }}>{value || "—"}</div>
        {scheme && <div style={{ marginTop: 3, fontSize: 11, color: "#777", fontWeight: 600 }}>{scheme}</div>}
      </div>
    </div>
  );
}